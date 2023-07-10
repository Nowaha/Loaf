const { exec } = require('child_process');
var fs = require('fs');

let file = process.argv[2];
if (file == undefined) {
    console.log("Please specify a file to build!");
    process.exit(1);
} else if (!fs.existsSync(file)) {
    console.log("Unknown file '" + file + "'.");
    process.exit(1);
}

let skip = 0;
let verbose = false;
let showErrors = false;
for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] == "-s" || process.argv[i] == "--skip") {
        try {
            skip = parseInt(process.argv[i + 1]);
        } catch (e) {
            console.log("Invalid value for skip. Must be a number!")
            process.exit(1);
        }
    } else if (process.argv[i] == "-v" || process.argv[i] == "--verbose") {
        verbose = true;
    } else if (process.argv[i] == "-e" || process.argv[i] == "--errors") {
        showErrors = true;
    }
}

const loadedFile = loadLoafFile(file);

function loadLoafFile(filePath) {
    let data = fs.readFileSync(filePath, 'utf8');
    let lines = data.split("\n");

    let doneExcl = false;

    const args = [];
    const instructions = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.trim().startsWith("#") || line.trim().length == 0) continue;
        line = line.split("#")[0].trim();

        if (line.startsWith("!")) {
            if (!doneExcl) {
                args.push(line.substring(1));
            } else {
                console.error(`Line ${i+1}: Rule after rule definitions ended!`);
                process.exit(1);
            }
            continue;
        } else {
            doneExcl = true;
        }

        if (line.startsWith("gradle ") || line.startsWith("maven ")) {
            const mode = line.split(" ")[0];
            const actionsRaw = line.split(" ").slice(1).join(" ");
            const actionsSplit = actionsRaw.split(",");
            const actions = [];
            
            for (const action of actionsSplit) {
                const actionTrim = action.trim();
                if (actionTrim.length == 0) {
                    console.error(`Line ${i+1}: Missing path!`);
                    process.exit(1);
                }
                if (!fs.existsSync(actionTrim)) {
                    console.error(`Line ${i+1}: Path ${actionTrim} does not exist!`);
                    process.exit(1);
                }
                
                actions.push(actionTrim.trim());
            }
            
            instructions.push({
                "mode": mode,
                "actions": actions
            });
        }
    }

    return {
        "args": args,
        "instructions": instructions
    };
}

function mavenInstall(dir, pull) {
    return new Promise((resolve, reject) => {
        exec(`cd ${dir} ${pull ? "&& git pull " : ""}&& mvn clean package install -U`, (err, stdout, stderr) => {
            if (err) {
                reject(err)
            } else {
                resolve(stdout)
            }
        })
    })
}

function gradleBuild(dir, pull) {
    return new Promise((resolve, reject) => {
        exec(`cd ${dir} ${pull ? "&& git pull " : ""}&& .\\gradlew build && .\\gradlew publishToMavenLocal`, (err, stdout, stderr) => {
            if (err) {
                reject(err)
            } else {
                resolve(stdout)
            }
        })
    })
}

async function main() {
    const start = Date.now();

    let index = 0;
    const pull = loadedFile.args.includes("pull");
    for (const instruction of loadedFile.instructions) {
        let running = [];
        const single = instruction.actions.length == 1;
        if (!single) {
            const numbers = [];
            for (let i = 0; i < instruction.actions.length; i++) {
                numbers.push(index + 1 + i);
            }
            console.log(color(`${numbers.join(", ")}. Building Multiple: ${instruction.actions.join(", ")}...`, 33));
        }
        for (const action of instruction.actions) {
            if (index++ < skip) {
                if (single) console.log(color(`${index}. Skipped ${action}.`, 33));
                else console.log(color(`-> ${action} skipped!`, 33));
            } else {
                if (single) console.log(color(`${index}. Building ${action}...`, 33));
                running.push(handle(action, instruction.mode == "gradle" ? gradleBuild(action, pull) : mavenInstall(action, pull), single));
            }
        }
        await Promise.all(running);
        if (!single) console.log(" ");
    }

    console.log(color(`Finished all after ${(Date.now() - start) / 1000} seconds!`, 32))
}

function color(str, color) {
    return `\x1b[${color}m${str}\x1b[0m`
}

async function handle(name, promise, single) {
    const start = Date.now()
    await promise.then(it => {
        if (verbose) console.log(it)
        if (single) console.log(color(`-> Built! (${Date.now() - start} ms)`, 32))
        else console.log(color(`-> ${name} built! (${Date.now() - start} ms)`, 32))
    }
    ).catch(it => {
        if (verbose || showErrors) console.log(it)
        if (single) console.log(color(`-> Failed! (${Date.now() - start} ms)`, 31))
        else console.log(color(`-> ${name} failed! (${Date.now() - start} ms)`, 31))
    }
    )
    if (single) console.log(" ")
}

main();