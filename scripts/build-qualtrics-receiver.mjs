import { readFile, writeFile } from 'node:fs/promises';
import { createQualtricsCodec } from '../js/qualtrics-bundle.mjs';

// QSF import is still subject to live-account validation. No third-party survey
// content, owner IDs, libraries, external scripts, or API credentials are used.
const surveyId = 'SV_FAEReceiverDraft';
const blockId = 'BL_FAEReceiver';
const source = await readFile(new URL('../qualtrics/receiver-question.js', import.meta.url), 'utf8');
const questionJS = `(function () {\n${createQualtricsCodec.toString()}\n${source}\n}());`;
const codec = createQualtricsCodec();
const element = (Element, PrimaryAttribute, Payload, SecondaryAttribute = null) =>
  ({ SurveyID: surveyId, Element, PrimaryAttribute, SecondaryAttribute, TertiaryAttribute: null, Payload });
const embeddedData = codec.fieldNames.map(name => ({
  Description: '__js_' + name, Type: 'Recipient', Field: '__js_' + name, VariableType: 'String', DataVisibility: [], AnalyzeText: false
}));
for (const [Field, Value] of [['__js_fae_receiver_status', 'pending'], ['__js_fae_receiver_error', '']]) {
  embeddedData.push({ Description: Field, Type: 'Custom', Field, Value, VariableType: 'String', DataVisibility: [], AnalyzeText: false });
}
const qsf = {
  SurveyEntry: {
    SurveyID: surveyId, SurveyName: 'FAE ZIP Receiver — PROTOTYPE',
    SurveyDescription: 'Separate receiver for synthetic validation. Not connected to the live task.',
    SurveyLanguage: 'EN', SurveyStatus: 'Inactive',
    SurveyStartDate: '0000-00-00 00:00:00', SurveyExpirationDate: '0000-00-00 00:00:00'
  },
  SurveyElements: [
    element('BL', 'Survey Blocks', [{ Type: 'Default', Description: 'Automatic data receiver - JS fields', ID: blockId,
      BlockElements: [{ Type: 'Question', QuestionID: 'QID1' }],
      Options: { BlockLocking: 'false', RandomizeQuestions: 'false', BlockVisibility: 'Expanded' } }]),
    element('FL', 'Survey Flow', { Type: 'Root', FlowID: 'FL_1', Flow: [
      { Type: 'EmbeddedData', FlowID: 'FL_2', EmbeddedData: embeddedData },
      { Type: 'Block', ID: blockId, FlowID: 'FL_3' }
    ], Properties: { Count: 3 } }),
    element('QC', 'Survey Question Count', null, '1'),
    element('SO', 'Survey Options', {
      BackButton: 'false', SaveAndContinue: 'false', SurveyProtection: 'PublicSurvey',
      NoIndex: 'Yes', SecureResponseFiles: 'true', SurveyTermination: 'DefaultMessage',
      Header: '', Footer: '', ProgressBarDisplay: 'None', PageTransition: 'None',
      PartialData: '+1 week', PartialDataCloseAfter: 'LastActivity',
      PreviousButton: 'Back', NextButton: 'Submit', SurveyTitle: 'Saving task data',
      CollectGeoLocation: 'false', AnonymizeResponse: 'Yes',
      SkinType: 'templated', Skin: { brandingId: null, templateId: '*base', overrides: null }
    }),
    element('SQ', 'QID1', {
      QuestionText: '<p data-fae-status>Verifying task data. Please keep this window open…</p>',
      DefaultChoices: false, DataExportTag: 'receiver', QuestionType: 'DB', Selector: 'TB',
      DataVisibility: { Private: false, Hidden: false },
      Configuration: { QuestionDescriptionOption: 'UseText' },
      QuestionDescription: 'Automatic ZIP integrity check', ChoiceOrder: [],
      Validation: { Settings: { Type: 'None' } }, GradingData: [], Language: [],
      NextChoiceId: 1, NextAnswerId: 1, QuestionID: 'QID1', QuestionJS: questionJS
    }, 'Automatic ZIP integrity check')
  ]
};
const destination = new URL('../qualtrics/FAE_ZIP_Receiver_PROTOTYPE.qsf', import.meta.url);
await writeFile(destination, JSON.stringify(qsf, null, 2) + '\n');
await writeFile(new URL('../qualtrics/receiver-question-complete.js', import.meta.url), questionJS.trimEnd() + '\n');
await writeFile(new URL('../qualtrics/FAE_Receiver_JS.js', import.meta.url), questionJS.trimEnd() + '\n');
// Official advanced-text import is a fallback if the hand-built QSF is rejected.
const textImport = ['[[AdvancedFormat]]', ...codec.fieldNames.map(name => `[[ED:__js_${name}]]`),
  '[[ED:__js_fae_receiver_status:pending]]', '[[ED:__js_fae_receiver_error]]',
  '[[Block:Automatic data receiver - JS fields]]', '[[Question:DB]]', '[[ID:receiver]]',
  'Verifying task data. Please keep this window open.', ''].join('\n');
await writeFile(new URL('../qualtrics/FAE_ZIP_Receiver_FALLBACK.txt', import.meta.url), textImport);
await writeFile(new URL('../qualtrics/FAE_Receiver_JS_Fields.txt', import.meta.url), textImport);
console.log(`Created ${destination.pathname} (${codec.fieldNames.length + 2} embedded fields). Import has not been live-tested.`);
