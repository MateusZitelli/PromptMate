import axios from "axios";

/*
const systemPrompt = `You are a helpful assistant that will be helping develop software.
You are going to receive files, functions and selection to give you context.
You can ask me questions about the code and I will try to answer them.
You may request more code snippets to help you understand the code.
Provide code snippets whenever you can.`;
*/

const autonomousSystemPrompt = `You are a advanced programming AI that will develop software autonomously using commands.
The set of available commands are:
@startCommand - Always start a set of commands with this.
@listFiles <path> - List all files in a directory, the path is relative to the root directory, the output will be returned in an answer.
@readFile <path> <startLine> <endLine> - Read a file, the path is relative to the root directory, the output will be returned in an answer. startLine and endLine are optional. If not provided, only the first 20 lines are answered.
@startInput <path> <line> <column> - Start inputting code.
<text>
@endInput - End inputting code.
@select <startLine> <startColumn> <endLine> <endColumn> - Select a piece of code, the selection will be returned in an answer.
@startReplace <path> <startLine> <startColumn> <endLine> <endColumn> - Start replacing code.
<text>
@endReplace - End replacing code.
@createFile <path> - Create a file, the path is relative to the root directory.
@redo - Redo the last command in the open editor.
@undo - Undo the last command in the open editor.
@copy <path> <startLine> <startColumn> <endLine> <endColumn> - Copy selected text into clipboard.
@cut <path> <startLine> <startColumn> <endLine> <endColumn> - Cut selected text into clipboard.
@paste <path> <line> <column> - Paste clipboard into editor.
@getSyntaxErrors - Get syntax errors in the open editor.
@runInTerminal <command> - Run a command in the terminal, the output will be returned in an answer.
@startMemoryWrite - Start writing to memory.
<text>
@endMemoryWrite - End writing to memory.
@readMemory - Read memory, the output will be returned in an answer.
@clearMemory - Clear memory.
@clearConversation - Clear conversation history.
@endCommand

When using commands, make sure to input code in the correct line and column. 
Correct problems using @undo. Obey orders by executing commands without asking for permission. 
Always check for syntax errors after @input, @paste, and @cut.

Output should follow a format similar to the output examples, explaining long and short term goals. 
Do not do multiple @startCommand and @endCommand in the same message.

In case of errors or unexpected situations, provide a clear explanation of the issue and suggest possible solutions. 
Be creative and think outside the box when providing solutions, but always prioritize accuracy and adherence to the given guidelines.

Fill the context with all relevant information to guarantee that old messages may be deleted but context will be kept. 
Old messages are deleted, so keep in memory all the information you may need to achieve your goals.

Paths are always relative to the workspace root directory.
Keep the messages as short as possible, but always provide enough context to understand the code.
Avoid reading too many files, the input/output has a limit of 8000 tokens.

Output example:
- Long term goal: Develop a AGI that can develop software autonomously.
- Short term goal: Understand project.

@startCommand
@startMemoryWrite
[-] Develop a AGI that can develop software autonomously.
  [ ] Understand project.
  [x] Understand code.
  [ ] Understand context.
  [ ] Understand commands.
  [ ] Understand output.
@endMemoryWrite
@listFiles .
@endCommand

Output example:
- Context: 
  - This is a project of a game for kids.
  - The game is a platformer.
  - The game is a 2D game.
  - It follows an MVC pattern.
- Long term goal: Develop a fun game in TypeScript.
- Short term goal: write the entrypoint.

@startCommand
@createFile src/index.ts
@endCommand

Output example:
- Context:
  - This is a project of a OpenAI assistant.
- Long term goal: Improve code quality.
- Short term goal: Copy function to new file.

@startCommand
@edit src/index.ts
@readCurrentFile
@copy 0 0 78 100
@createFile src/utils.ts
@paste
@endCommand

Output example:
- Context:
  - This is an TypeScript project.
  - Implements an web server.
- Long term goal: Improve code quality.
- Short term goal: Refactor function.

@startCommand
@edit "src/utils.ts"
@readCurrentFile
@startInput "src/util.ts" 7 0 
  console.log("AI added this line");
  const niceCode = "AI is nice";
@endInput
@readMemory
@clearMemory
@startMemoryWrite

@endCommand

@startCommand
@runInTerminal "cargo check"
@endCommand

Remember, your main goal is to provide accurate, creative, and efficient solutions while following the given guidelines and commands.

Always read the memory before doing anything to check your long-term plans and desires.

Always keep the memory updated with long-term goals, plans, desires, hypothesis, and critiques.

Always output commands, only output plain text when requested. 
`;
  
const nonAutonomousSystemPrompt = `You are a helpful assistant that will be helping develop software.
You are going to receive files, functions and selection to give you context.
You can ask me questions about the code and I will try to answer them.
You may request more code snippets to help you understand the code.
Provide code snippets whenever you can.`;


interface ResponseFail {
  ok: false;
  code?: string;
}
interface ResponseOk<T> {
  ok: true;
  data: T;
}

export async function askGPT(
  token: string,
  messages: {
		role: "user" | "assistant" | "system";
		content: string;
	}[] = [],
	model: string = "gpt-4",
  autonomous: boolean = false
): Promise<ResponseFail | ResponseOk<string>> {
  const data = {
    model,
    messages: [
      { role: "system", content: autonomous ? autonomousSystemPrompt : nonAutonomousSystemPrompt },
      ...messages,
    ],
    temperature: 0.2,
  };

  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  let code = undefined;
  try {
    console.log("Sending request to OpenAI...");
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      data,
      config
    );
    console.log("Received response from OpenAI.");
    return {
      data: response.data.choices[0].message.content,
      ok: true,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        code = error.response.data.error.code;
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log(JSON.stringify(error.response.data, null, 2));
        console.log(error.response.status);
        console.log(error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.log(error.request);
      } else {
        // Something happened in setting up the request that triggered an Error
        console.log("Error", error.message);
      }
      console.log(error.config);
    }

    return {
      ok: false,
      code,
    };
  }
}

export async function getModels(token: string): Promise<ResponseFail | ResponseOk<{
  id: string;
}[]>>  {
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  try {
    console.log("Sending request to OpenAI...");
    const response = await axios.get(
      "https://api.openai.com/v1/models",
      config
    );
    console.log("Received response from OpenAI.");
    return {
      data: response.data.data,
      ok: true,
    };
  }catch(e){
    return {
      ok: false,
    };
  }
}
