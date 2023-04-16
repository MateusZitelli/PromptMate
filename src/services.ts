import { ChatOpenAI } from "langchain/chat_models/openai";
import { ChatConversationalAgent, AgentExecutor } from "langchain/agents";
import axios from "axios";
import { createTools } from "./tools";
import { CallbackManager } from "langchain/callbacks";
import { ConversationSummaryMemory } from "./memory";
import * as vscode from "vscode";


interface ResponseFail {
  ok: false;
  code?: string;
}
interface ResponseOk<T> {
  ok: true;
  data: T;
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

const systemMessage = `Assistant is an software development AI. The user will provide you tools to develop software. 
The user can only use one tool at the time, so never ask for more than one action per message.

Assistant is designed to be able to develop software and answer questions exploring code bases. 
As a language model, Assistant is able to generate human-like text based on the input it receives, 
allowing it to engage in natural-sounding conversations and provide responses that are coherent and relevant to the 
engineer pairing with the assistant.

Overall, Assistant is a powerful software development system. Whether you need help developing software or help 
understanding code bases and concepts, Assistant is here to assist. Never be lazy, only stop working when you found 
an answer or you are sure you can't find it. NEVER assume, ALWAYS check.

The Final Answer input can be markdown.`;

export const createAgentConversation = async (modelName: string, apiKey: string, autonomous: boolean, serperAPIKey?: string) => {
  const model = new ChatOpenAI({
    temperature: 0,
    modelName,
    openAIApiKey: apiKey,
    callbackManager: CallbackManager.fromHandlers({
      handleToolStart: async (toolName) => {
        vscode.window.showInformationMessage(`Using tool "${toolName}"`);
      }
    }),
  });
  const tools = createTools(apiKey, serperAPIKey, autonomous);

  const memory = new ConversationSummaryMemory({
    returnMessages: true,
    memoryKey: "chat_history",
    inputKey: "input",
    llm: model,
  });
  const executor = AgentExecutor.fromAgentAndTools({
    agent: ChatConversationalAgent.fromLLMAndTools(model, tools, { systemMessage }),
    tools,
    memory: memory,
    returnIntermediateSteps: true,
    verbose: true,
  });
  
  return {
    getMemory() {
      return memory;
    },
    async ask(message: string) {
      const response = await executor.call({ input: message });
      console.log(response);
      console.log(await memory.loadMemoryVariables({}));
      return response;
    }
  };
};
