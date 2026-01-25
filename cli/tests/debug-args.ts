import { createProgram } from "./src/cli/args.ts";

const args = ["--debug-open-code", "--opencode", "test task"];
console.log("Args:", args);
const program = createProgram();
program.parse(args);
const opts = program.opts();
console.log("Opts after parsing:", opts);
console.log("debugOpencode:", opts.debugOpencode);
console.log("debugOpenCode:", opts.debugOpenCode);
