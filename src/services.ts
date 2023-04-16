import { ChatOpenAI } from "langchain/chat_models/openai";
import { ChatConversationalAgent, AgentExecutor } from "langchain/agents";
import { BufferMemory } from "langchain/memory";
import axios from "axios";
import { createTools } from "./tools/execute";


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

export const createAgentConversation = async (modelName: string, apiKey: string) => {
  const model = new ChatOpenAI({ temperature: 0, modelName, openAIApiKey: apiKey });
  const tools = createTools();

  const bufferMemory = new BufferMemory({
    returnMessages: true,
    memoryKey: "chat_history",
    inputKey: "input",
  });
  const executor = AgentExecutor.fromAgentAndTools({
    agent: ChatConversationalAgent.fromLLMAndTools(model, tools, {
      systemMessage: `Assistant is a large language model trained by OpenAI.\n\nAssistant is designed to be able to develop software and answer questions exploring code bases. As a language model, Assistant is able to generate human-like text based on the input it receives, allowing it to engage in natural-sounding conversations and provide responses that are coherent and relevant to the engineer pairing with the assistant.\n\nAssistant is constantly learning and improving, and its capabilities are constantly evolving. It is able to process and understand large amounts of text, and can use this knowledge to develop software and execute any actions in the user machine. Additionally, Assistant is able to generate its own text based on the input it receives, allowing it to develop software and answer questions about the current project.\n\nOverall, Assistant is a powerful software development system. Whether you need help developing software or help understanding code bases and concepts, Assistant is here to assist.` 
    }),
    tools,
    memory: bufferMemory,
    verbose: true,
  });
  executor.memory = bufferMemory;
  
  return {
    getConversation() {
      return bufferMemory.chatHistory;
    },
    async ask(message: string) {
      const response = await executor.call({ input: message });
      console.log(response);
      return response;
    }
  };
};
