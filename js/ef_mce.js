const create_ef_trials = function(n_trials){
    //this is jspsych shuffle, but let's put it in here to make this function 'stand-alone'
    const shuffle = function(array) {
        if (!Array.isArray(array)) {
            console.error("Argument to shuffle() must be an array.");
        }
        const copy_array = array.slice(0);
        let m = copy_array.length, t, i;
        // While there remain elements to shuffle…
        while (m) {
            // Pick a remaining element…
            i = Math.floor(Math.random() * m--);
            // And swap it with the current element.
            t = copy_array[m];
            copy_array[m] = copy_array[i];
            copy_array[i] = t;
        }
        return copy_array;
    }

    //create an empty array to store all of our stimuli
    let trial_array = [],
        all_targets = []

    //Let's create 50% of the three letter, two number stimuli
    for(let i = 0; i < (n_trials/4); i++){
       const create_letter_trial = function(i, type){
            // shuffle the letters and numbers
            let letters = shuffle(["A", "B", "C", "D", "E", "F","G","H","I","J","K","L","M","N","P","Q","R","S","T","U","V","W","X","Y","Z"])
            let numbers = shuffle([1,2,3,4,5,6,7,8,9])

            // take first 3 letters and first 2 numbers
            // note that this deletes them from the original array, so we know we won't have repeat numbers/letters
            let Ls = letters.splice(0,3)
            let Ns = numbers.splice(0,2)

            // paste together our target and solution text
            let target = Ls[0] + Ns[0] + Ls[1] + Ns[1] + Ls[2]
            let solution =  (Ns[0] + Ns[1]) + Ls.join("")

            // the distractor is more complicated
            let distractor, d_type

            // we have two types of distractors: change the letter or change the number
            // I use modulus here to make even i number-change and odd i letter-change distractors (makes an equal number)
            if(i % 2 > 0){
                // select two numbers and add them
                let new_n = shuffle(numbers)[0] + shuffle(numbers)[0]
                // make sure the sum doesn't equal the solution sum, if it does, select two more numbers and try again
                // "while" will keep going until it is 'false'
                while(new_n === (Ns[0] + Ns[1])){
                    new_n = shuffle(numbers)[0] + shuffle(numbers)[0]
                }
                // paste together our distractor text
                distractor = new_n + Ls.join("")
                // save the type of distractor it is for later
                d_type = "number"

            } else {
                // here, we randomly choose to change one of the three letters and paste the text together
                // note that since we deleted the original letters from the 'letters' array so we don't need to check to see if they repeat
                d_type = "letter"
                let s = shuffle([0,1,2])[0]
                if(s === 0){
                    distractor =  (Ns[0] + Ns[1]) + (shuffle(letters).pop() + Ls[1] + Ls[2])
                }
                if(s === 1){
                    distractor = (Ns[0] + Ns[1]) + (Ls[0] + shuffle(letters).pop() + Ls[2])
                }
                if(s === 2){
                    distractor = (Ns[0] + Ns[1]) + (Ls[0] + Ls[1] + shuffle(letters).pop())
                }
            }

            // let's also establish the order of the buttons here, so we can record that too (probably don't need that, but why not..)


           let choice_order
           if(type === 0){
               choice_order = ["distractor", "solution"]
           }

           if(type === 1){
               choice_order = ["solution", "distractor"]
           }

            return ({
                target: target,
                solution: solution,
                distractor: distractor,
                distractor_type: d_type,
                choice_order: choice_order.join("-"),
                choices: (choice_order[0] === "distractor")?[distractor, solution]:[solution, distractor]
            })
        }
        let new_trial

        // create both types an equal amount
        new_trial = create_letter_trial(i, 0)
        while(all_targets.includes(new_trial.target)){
            new_trial = create_letter_trial(i, 0)
        }

        all_targets.push(new_trial.target)
        trial_array.push(new_trial)


        new_trial = create_letter_trial(i, 1)
        while(all_targets.includes(new_trial.target)){
            new_trial = create_letter_trial(i, 1)
        }

        all_targets.push(new_trial.target)
        trial_array.push(new_trial)

    }

    //Now let's create 50% of the two letter, three number stimuli
    //This largely the same as the above, with a few changes
    for(let i = 0; i < (n_trials/4); i++){
        const create_number_trial = function(i, type) {
            // shuffle the letters and numbers
            let letters = shuffle(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"])
            let numbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])

            // take first 3 letters and first 2 numbers
            // note that this deletes them from the original array, so we know we won't have repeat numbers/letters
            let Ls = letters.splice(0, 2)
            let Ns = numbers.splice(0, 3)

            // paste together our target and solution text
            let target = Ns[0] + Ls[0] + Ns[1] + Ls[1] + Ns[2]
            let solution = (Ns[0] + Ns[1] + Ns[2]) + Ls.join("")

            // the distractor is more complicated
            let distractor, d_type

            // we have two types of distractors: change the letter or change the number
            // I use modulus here to make even i number and odd i letter distractors (makes an equal number of each trial)
            if (i % 2 > 0) {
                // select two numbers and add them
                let new_n = shuffle(numbers)[0] + shuffle(numbers)[0] + shuffle(numbers)[0]
                // make sure the sum doesn't equal the solution sum, if it does, select two more numbers and try again
                // "while" will keep going until it is 'false'
                while (new_n === (Ns[0] + Ns[1] + Ns[2])) {
                    new_n = shuffle(numbers)[0] + shuffle(numbers)[0] + shuffle(numbers)[0]
                }
                // paste together our distractor text
                distractor = new_n + Ls.join("")
                // save the type of distractor it is for later
                d_type = "number"

            } else {
                // here, we randomly choose to change one of the three letters and paste the text together
                // note that since we deleted the original letters from the 'letters' array so we don't need to check to see if they repeat
                d_type = "letter"
                let s = shuffle([0, 1])[0]
                if (s === 0) {
                    distractor = (Ns[0] + Ns[1] + Ns[2]) + (shuffle(letters).pop() + Ls[1])
                }
                if (s === 1) {
                    distractor = (Ns[0] + Ns[1] + Ns[2]) + (Ls[0] + shuffle(letters).pop())
                }

            }

            // let's also establish the order of the buttons here, so we can record that too (probably don't need that, but why not..)
            let choice_order
            if(type === 0){
                choice_order = ["distractor", "solution"]
            }

            if(type === 1){
                choice_order = ["solution", "distractor"]
            }

            return ({
                target: target,
                solution: solution,
                distractor: distractor,
                distractor_type: d_type,
                choice_order: choice_order.join("-"),
                choices: (choice_order[0] === "distractor")?[distractor, solution]:[solution, distractor]
            })
        }
        let new_trial

        new_trial = create_number_trial(i, 0)
        while(all_targets.includes(new_trial.target)){
            new_trial = create_number_trial(i, 0)
        }

        all_targets.push(new_trial.target)
        trial_array.push(new_trial)

        new_trial = create_number_trial(i, 1)
        while(all_targets.includes(new_trial.target)){
            new_trial = create_number_trial(i, 1)
        }

        all_targets.push(new_trial.target)
        trial_array.push(new_trial)

    }

    // let's shuffle the array before we return it
    trial_array = shuffle(trial_array)

    return trial_array
}