export class Command {
  name: string;
  args: string[];

  constructor(name: string, args: string[] = []) {
    this.name = name;
    this.args = args;
  }
}

export function parseLine(line: string): [string, string[]] | undefined {
  if (!line.startsWith("@")) {
    return;
  }
  const parts = line.slice(1).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const name = parts[0];
  const args = parts.slice(1).map((arg) => {
    try{
      return JSON.parse(arg);
    } catch (e) {
      if(name === "input") {
        throw new Error(`Invalid input: ${arg} ${e}`);
      }
      return arg;
    }
  });

  if (!name) {
    return;
  }

  return [name, args];
}

export function parseCommands(input: string): Command[] {
  const lines = input.split("\n");
  const commands: Command[] = [];
  let parsing = false;
  let parsingInput = false;
  let parsingReplace = false;
  let parsingMemoryWrite = false;
  let inputText = "";
  let currentCommand: Command | null = null;

  for (const line of lines) {
    const parseResult = parseLine(line);
    if (!parseResult) {
      if (parsingInput || parsingReplace) {
        inputText += line + "\n";
      }
      continue;
    }

    const [name, args] = parseResult;

    if (name === "startCommand") {
      parsing = true;
    } else if (name === "endCommand") {
      parsing = false;
    } else if (parsing && name) {
      if (name === "startInput") {
        parsingInput = true;
        currentCommand = new Command("input", args);
      } else if (name === "endInput") {
        parsingInput = false;
        if (currentCommand) {
          const inputArgs = [...currentCommand.args, inputText.trim()];
          commands.push(new Command(currentCommand.name, inputArgs));
          inputText = "";
          currentCommand = null;
        }
      } else if (name === "startReplace") {
        parsingReplace = true;
        currentCommand = new Command("replace", args);
      } else if (name === "endReplace") {
        if (currentCommand) {
          const inputArgs = [...currentCommand.args, inputText.trim()];
          commands.push(new Command(currentCommand.name, inputArgs));
          inputText = "";
          currentCommand = null;
        }
      } else if (name === "startMemoryWrite") {
        parsingMemoryWrite = true;
        currentCommand = new Command("memoryWrite", args);
      } else if (name === "endMemoryWrite") {
        if (currentCommand) {
          const inputArgs = [...currentCommand.args, inputText.trim()];
          commands.push(new Command(currentCommand.name, inputArgs));
          inputText = "";
          currentCommand = null;
        }
      } else if (!parsingInput && !parsingReplace && !parsingMemoryWrite) {
        commands.push(new Command(name, args));
      }
    }
  }

  return commands;
}
