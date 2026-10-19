#!/usr/bin/env python3
"""Restore original ZIPs and their files from one Qualtrics CSV/JSON export.

No dependencies outside Python's standard library. Nothing is sent over a network.
Usage: python3 scripts/restore-qualtrics-bundles.py responses.csv restored
"""
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import zipfile

SCHEMA = 'fae-qualtrics-zip-v1'
CHUNK_SIZE, MAX_CHUNKS = 18000, 256


def normalize_receiver_fields(row):
    """Select one complete receiver namespace, never a mix of old/new fields.

    Qualtrics exports JS embedded data with its ``__js_`` prefix intact. If
    even one of those columns is present, all receiver values (including the
    verification status) must come from that namespace. Empty/missing new
    values cannot be rescued by a stale, verified legacy payload.
    """
    if any(isinstance(key, str) and key.startswith('__js_fae_') for key in row):
        normalized = {key: value for key, value in row.items()
                      if not (isinstance(key, str) and key.startswith('fae_'))}
        normalized.update({key[len('__js_'):]: value for key, value in row.items()
                           if isinstance(key, str) and key.startswith('__js_fae_')})
        return normalized
    return row


def responses(path):
    with path.open(encoding='utf-8-sig', newline='') as source:
        if path.suffix.lower() == '.json':
            data = json.load(source)
            rows = data if isinstance(data, list) else data.get('responses')
            if not isinstance(rows, list):
                raise ValueError('Expected a Qualtrics JSON export with a responses array')
            for item in rows:
                yield normalize_receiver_fields(item.get('values', item))
        else:
            reader = csv.DictReader(source)
            if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
                raise ValueError('Missing or duplicate CSV column names')
            schema_columns = [name for name in ('__js_fae_schema', 'fae_schema')
                              if name in reader.fieldnames]
            if not schema_columns:
                raise ValueError('CSV does not include receiver embedded data columns')
            for index, row in enumerate(reader):
                # Qualtrics CSV contains two metadata rows after the column names.
                labels = [row.get(name) or '' for name in schema_columns]
                if index < 2 and any(value in ('fae_schema', '__js_fae_schema') or
                                     value.startswith('{"ImportId":') for value in labels):
                    continue
                # Qualtrics CSV exports protect spreadsheet-formula prefixes
                # with an apostrophe. '+' is the only such prefix in valid
                # base64. Undo that one vendor escape only on ZIP chunks;
                # JSON and all integrity checks remain untouched.
                for key, value in row.items():
                    if (isinstance(key, str) and
                            re.fullmatch(r'(?:__js_)?fae_zip_[0-9]{4}', key) and
                            isinstance(value, str) and value.startswith("'+")):
                        row[key] = value[1:]
                yield normalize_receiver_fields(row)


def checked_archive(row):
    if str(row.get('Finished', row.get('finished', ''))).lower() not in ('1', 'true'):
        raise ValueError('Response is not marked Finished')
    if row.get('fae_receiver_status') != 'verified':
        raise ValueError('Receiver did not verify this response')
    if row.get('fae_schema') != SCHEMA:
        raise ValueError('Missing or unsupported receiver schema')
    name = str(row.get('fae_filename', ''))
    if len(name) > 256 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.zip', name):
        raise ValueError('Unsafe ZIP filename')
    if not row.get('fae_session_id') or not row.get('fae_subject_id'):
        raise ValueError('Missing session or subject ID')
    if row.get('fae_run_mode') not in ('probe', 'test', 'full'):
        raise ValueError('Invalid run mode')
    count, size = str(row.get('fae_chunk_count', '')), str(row.get('fae_zip_bytes', ''))
    if not re.fullmatch(r'[1-9][0-9]*', count) or not re.fullmatch(r'[1-9][0-9]*', size):
        raise ValueError('Invalid chunk count or byte count')
    count, size = int(count), int(size)
    if count > MAX_CHUNKS or size > CHUNK_SIZE * MAX_CHUNKS * 3 // 4:
        raise ValueError('Envelope exceeds prototype capacity')
    chunks = []
    for index in range(1, MAX_CHUNKS + 1):
        value = row.get(f'fae_zip_{index:04d}', '') or ''
        if index > count:
            if value:
                raise ValueError('Unexpected extra ZIP chunk')
        elif not isinstance(value, str) or not 0 < len(value) <= CHUNK_SIZE or (index < count and len(value) != CHUNK_SIZE):
            raise ValueError(f'Missing or truncated chunk {index}')
        else:
            chunks.append(value)
    encoded = ''.join(chunks)
    if len(encoded) != 4 * ((size + 2) // 3):
        raise ValueError('Encoded size mismatch')
    binary = base64.b64decode(encoded, validate=True)
    if base64.b64encode(binary).decode('ascii') != encoded or len(binary) != size:
        raise ValueError('Noncanonical base64 or byte count mismatch')
    if hashlib.sha256(binary).hexdigest() != row.get('fae_zip_sha256'):
        raise ValueError('SHA-256 mismatch')
    with zipfile.ZipFile(io.BytesIO(binary)) as archive:
        infos = archive.infolist()
        if not 1 <= len(infos) <= 100 or sum(info.file_size for info in infos) > 32 * 1024 * 1024:
            raise ValueError('Unexpected ZIP contents or expansion size')
        names = set()
        for info in infos:
            parts = info.filename.split('/')
            if info.filename in names or info.filename == name or info.is_dir() or '\\' in info.filename or ':' in info.filename or any(part in ('', '.', '..') for part in parts):
                raise ValueError('Unsafe or duplicate archive path')
            names.add(info.filename)
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC mismatch')
    return name, binary


def restore_one(row, output):
    name, binary = checked_archive(row)
    destination = output / name[:-4]
    if destination.exists():
        if destination.is_symlink() or not destination.is_dir():
            raise ValueError('Existing output is not a regular directory')
        archive_path = destination / name
        if archive_path.is_symlink() or not archive_path.is_file() or archive_path.read_bytes() != binary:
            raise ValueError('Existing session differs; refusing to overwrite')
        with zipfile.ZipFile(io.BytesIO(binary)) as archive:
            for entry in archive.infolist():
                path = destination.joinpath(*PurePosixPath(entry.filename).parts)
                if any(parent.is_symlink() for parent in (path, *path.parents)) or not path.is_file() or path.read_bytes() != archive.read(entry):
                    raise ValueError('Existing extracted file differs; refusing to overwrite')
        return 'unchanged'
    temporary = Path(tempfile.mkdtemp(prefix='.fae-restore-', dir=output))
    try:
        (temporary / name).write_bytes(binary)
        with zipfile.ZipFile(io.BytesIO(binary)) as archive:
            for entry in archive.infolist():
                path = temporary.joinpath(*PurePosixPath(entry.filename).parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(entry))
        # A completed session appears only once all its files have been written.
        if destination.exists():
            raise ValueError('Output appeared during recovery; run only one recovery process')
        os.rename(temporary, destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return 'restored'


def main():
    if len(sys.argv) != 3:
        raise ValueError(__doc__.strip())
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    counts = {'restored': 0, 'unchanged': 0, 'rejected': 0}
    seen = {}
    for index, row in enumerate(responses(source), start=1):
        try:
            session = row.get('fae_session_id')
            fingerprint = (row.get('fae_zip_sha256'), row.get('fae_filename'))
            if session in seen and seen[session] != fingerprint:
                raise ValueError('Conflicting records for the same session ID')
            result = restore_one(row, output)
            seen[session] = fingerprint
            counts[result] += 1
        except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile) as error:
            counts['rejected'] += 1
            print(f'Record {index}: {error}', file=sys.stderr)
    print(json.dumps(counts))
    return 2 if counts['rejected'] else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, json.JSONDecodeError, csv.Error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
