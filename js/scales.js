let scale = ["Almost Never", "Very Infrequently", "Somewhat Infrequently", "Somewhat Frequently", "Very Frequently", "Almost Always"];
var maas = {
    type: jsPsychSurveyLikert,
    questions: [
        {
            prompt: "I could be experiencing some emotion and not be conscious of it until some time later.",
            labels: scale,
            required: true
        },
        {
            prompt: "I break or spill things because of carelessness, not paying attention, or thinking of something else.",
            labels: scale,
            required: true
        },
        {
            prompt: "I find it difficult to stay focused on what's happening in the present.",
            labels: scale,
            required: true
        },
        {
            prompt: "I tend to walk quickly to get where I'm going without paying attention to what I experience along the way.",
            labels: scale,
            required: true
        },
        {
            prompt: "I tend not to notice feelings of physical tension or discomfort until they really grab my attention.",
            labels: scale,
            required: true
        },
        {
            prompt: "I forget a person's name almost as soon as I've been told it for the first time.",
            labels: scale,
            required: true
        },
        {
            prompt: "It seems I am 'running on automatic' without much awareness of what I'm doing.",
            labels: scale,
            required: true
        },
        {prompt: "I rush through activities without being really attentive to them.", labels: scale, required: true},
        {
            prompt: "I get so focused on the goal I want to achieve that I lose touch with what I am doing right now to get there.",
            labels: scale,
            required: true
        },
        {
            prompt: "I do jobs or tasks automatically, without being aware of what I'm doing.",
            labels: scale,
            required: true
        },
        {
            prompt: "I find myself listening to someone with one ear, doing something else at the same time.",
            labels: scale,
            required: true
        },
        {
            prompt: "I drive places on 'automatic pilot' and then wonder why I went there.",
            labels: scale,
            required: true
        },
        {prompt: "I find myself preoccupied with the future or the past.", labels: scale, required: true},
        {prompt: "I find myself doing things without paying attention.", labels: scale, required: true},
        {prompt: "I snack without being aware that I'm eating.", labels: scale, required: true}
    ],
    randomize_question_order: true,
    scale_width: 800,
    preamble: "Below is a collection of statements about your everyday experience. Using the 1-6 scale below, please indicate how frequently or infrequently you currently have each experience. Please answer according to what really reflects your experience rather than what you think your experience should be. Please treat each item separately from every other item"
};

scale = ["1 <br> Low Occurrence", "2", "3", "4", "5", "6", "7 <br> High Occurrence"];
var mwsd = {
    type: jsPsychSurveyLikert,
    questions: [
        {prompt: "I find my thoughts wandering spontaneously", labels: scale, required: true},
        {prompt: "When I mind-wander my thoughts tend to be pulled from topic to topic", labels: scale, required: true},
        {prompt: "It feels like I don't have control over when my mind wanders", labels: scale, required: true},
        {prompt: "I mind-wander even when I'm supposed to be doing something else", labels: scale, required: true},

        {prompt: "I allow my thoughts to wander on purpose", labels: scale, required: true},
        {prompt: "I enjoy mind-wandering", labels: scale, required: true},
        {prompt: "I find mind-wandering is a good way to cope with boredom", labels: scale, required: true},
        {prompt: "I allow myself to get absorbed in pleasant fantasy", labels: scale, required: true}
    ],
    randomize_question_order: true,
    scale_width: 500,
    preamble: "For the following statements please select the answer that most accurately reflects your everyday experiences from 1 (low occurrence) to 7 (high occurrence)."
};
