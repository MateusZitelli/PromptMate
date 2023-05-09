import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMessage, SystemChatMessage, InputValues, ChatMessage } from "langchain/schema";
import { BaseChatMemory, ChatMessageHistory } from "langchain/memory";
import { SUMMARY_PROMPT } from "./prompt";
import { BasePromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";

export interface BaseMemoryInput {
  chatHistory?: ChatMessageHistory;
  returnMessages?: boolean;
  inputKey?: string;
  outputKey?: string;
}

export type ConversationSummaryMemoryInput = BaseMemoryInput & {
  memoryKey?: string;
  humanPrefix?: string;
  aiPrefix?: string;
  llm: BaseLanguageModel;
  prompt?: BasePromptTemplate;
  summaryChatMessageClass?: new (content: string) => BaseChatMessage;
};

export type OutputValues = Record<string, any>;
export type MemoryVariables = Record<string, any>;

export const getInputValue = (inputValues: InputValues, inputKey?: string): string => {
  if (inputKey !== undefined) {
    return inputValues[inputKey];
  }
  const keys = Object.keys(inputValues);
  if (keys.length === 1) {
    return inputValues[keys[0]];
  }
  
  return JSON.stringify(inputValues);
};

export class ConversationSummaryMemory extends BaseChatMemory {
  buffer = "";

  memoryKey = "history";

  humanPrefix = "Human";

  aiPrefix = "AI";

  llm: BaseLanguageModel;

  prompt: BasePromptTemplate = SUMMARY_PROMPT;

  summaryChatMessageClass: new (content: string) => BaseChatMessage =
    SystemChatMessage;

  constructor(fields?: ConversationSummaryMemoryInput) {
    const {
      returnMessages,
      inputKey,
      outputKey,
      chatHistory,
      humanPrefix,
      aiPrefix,
      llm,
      prompt,
      summaryChatMessageClass,
    } = fields ?? {};

    super({ returnMessages, inputKey, outputKey, chatHistory });

    this.memoryKey = fields?.memoryKey ?? this.memoryKey;
    this.humanPrefix = humanPrefix ?? this.humanPrefix;
    this.aiPrefix = aiPrefix ?? this.aiPrefix;
    this.llm = llm!;
    this.prompt = prompt ?? this.prompt;
    this.summaryChatMessageClass =
      summaryChatMessageClass ?? this.summaryChatMessageClass;
  }

  async predictNewSummary(
    messages: BaseChatMessage[],
    existingSummary: string
  ): Promise<string> {
    const newLines = getBufferString(messages, this.humanPrefix, this.aiPrefix);
    const chain = new LLMChain({ llm: this.llm, prompt: this.prompt });
    return await chain.predict({
      summary: existingSummary,
      new_lines: newLines,
    });
  }

  async loadMemoryVariables(_: InputValues): Promise<MemoryVariables> {
    if (this.returnMessages) {
      const result = {
        [this.memoryKey]: [new this.summaryChatMessageClass(this.buffer)],
      };
      return result;
    }
    const result = { [this.memoryKey]: this.buffer };
    return result;
  }

  async saveContext(
    inputValues: InputValues,
    outputValues: OutputValues
  ): Promise<void> {
    this.chatHistory.addUserMessage(getInputValue(inputValues, this.inputKey));
    this.chatHistory.addAIChatMessage(
      getInputValue(outputValues, this.outputKey)
    );
    const messages = await this.chatHistory.getMessages();
    this.buffer = await this.predictNewSummary(messages.slice(-2), this.buffer);
  }

  async clear() {
    await super.clear();
    this.buffer = "";
  }
}
function getBufferString(
  messages: BaseChatMessage[],
  human_prefix = "Human",
  ai_prefix = "AI"
): string {
  const string_messages: string[] = [];
  for (const m of messages) {
    let role: string;
    if (m._getType() === "human") {
      role = human_prefix;
    } else if (m._getType() === "ai") {
      role = ai_prefix;
    } else if (m._getType() === "system") {
      role = "System";
    } else if (m._getType() === "generic") {
      role = (m as ChatMessage).role;
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
    string_messages.push(`${role}: ${m.text}`);
  }
  return string_messages.join("\n");
}
