import * as vscode from "vscode";
import { micromark } from "micromark";
import "dotenv/config";
import html from "./index.html";
import { createAgentConversation, getModels } from "./services";
import { Message } from "./tools";
import { handleAddPromptEvent, CodePrompt as CodePrompt } from "./prompt";
import './fetch-polyfill';

export async function activate(context: vscode.ExtensionContext) {
  const generateConversationAgent = () => {
    if (openAIKey) {
      return createAgentConversation(model, openAIKey, autonomous, serperApiKey);
    }
  };

  let panel: vscode.WebviewPanel | undefined;
  let conversationHistory: Message[] = [];
  let codePrompts: CodePrompt[] = [];
  let lastActiveEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  let currentUserRequest = "";
  let models: string[] = [];
  let openAIKey: string | undefined = context.globalState.get(
    "openaiUserToken",
    undefined
  );
  let serperApiKey: string | undefined = context.globalState.get(
    "serperAPIKey",
    undefined
  );
  let renderMarkdown = true;
  let model = context.globalState.get("openaiModel", "gpt-3.5-turbo");
  let loading = false;
  let lastConversationLength = 0;
  let autonomous = context.globalState.get("autonomous", false);
  let conversationAgent = await generateConversationAgent();

  const loadUI = () => {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = createWebviewPanel();
    panel.onDidDispose(() => {
      panel = undefined;
    });

    panel?.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "askGPT" && !loading && openAIKey) {
        await handleAskGPTEvent(message);
      } else if (message.type === "updateToken") {
        console.log(message);
        context.globalState.update("openaiUserToken", message.token);
        context.globalState.update("serperAPIKey", message.serperApiKey);
        openAIKey = message.token;
        serperApiKey = message.serperApiKey;
        conversationAgent = await generateConversationAgent();
        await loadModels();
      } else if (message.type === "updateModel") {
        context.globalState.update("openaiModel", message.model);
        model = message.model;
        conversationAgent = await generateConversationAgent();
      } else if (message.type === "addPrompt") {
        codePrompts = await handleAddPromptEvent(
          lastActiveEditor,
          codePrompts,
          message.prompt
        );
      } else if (message.type === "removePrompt") {
        codePrompts.splice(message.index, 1);
      } else if (message.type === "updateQuestion") {
        currentUserRequest = message.userRequest;
      } else if (message.type === "init") {
        if (openAIKey) {
          await loadModels();
        }
      } else if (message.type === "clearConversation") {
        conversationHistory = [];
        conversationAgent?.getMemory().clear();
      }else if (message.type === "toggleMarkdown") { 
        handleToggleMarkdownEvent();
      }else if (message.type === "deleteMessage") {
        conversationHistory.splice(message.index, 1);
        conversationAgent?.getMemory().chatHistory.messages.splice(message.index, 1);
      }else if (message.type === "updateAutonomous") {
        autonomous = message.autonomous;
        context.globalState.update("autonomous", message.autonomous);
      }

      await updateUI();
    });
  };

  const updateUI = async () => {
    // we do this to avoid the conversation UI scrolling to the top on every UI update
    if (lastConversationLength !== conversationHistory.length) {
      await panel?.webview.postMessage({
        type: "conversationUpdate",
        conversationHistory: conversationHistory.map((m) => ({
          role: m.role,
          content: renderMarkdown ? micromark(m.text) : m.text,
          isMarkdown: renderMarkdown,
          codePrompt: m.codePrompt ? [...m.codePrompt] : undefined,
        })),
      });
      lastConversationLength = conversationHistory.length;
    }
    await panel?.webview.postMessage({ type: "loading", loading });
    await panel?.webview.postMessage({
      type: "prompt",
      prompt: codePrompts ? [...codePrompts] : undefined,
    });
    await panel?.webview.postMessage({ type: "token", token: openAIKey });
    await panel?.webview.postMessage({ type: "serperApiKey", serperApiKey });
    await panel?.webview.postMessage({
      type: "currentFullPrompt",
      fullPrompt: buildPrompt(codePrompts, currentUserRequest),
    });
    await panel?.webview.postMessage({ type: "model", model });
    await panel?.webview.postMessage({ type: "models", models });
    await panel?.webview.postMessage({ type: "autonomous", autonomous });
  };
  
  const handleToggleMarkdownEvent = async () => {
    renderMarkdown = !renderMarkdown;
    updateUI();
  };

  const handleAskGPTEvent = async (message: any) => {
    if (loading) {
      return;
    }
    let error = false;
    loading = true;
    conversationHistory.push({
      role: "user",
      codePrompt: [...codePrompts],
      text: message.userRequest,
    });

    await updateUI();
    
        
    const response = await conversationAgent?.ask(buildPrompt([...codePrompts], message.userRequest));
    
    if(!response) {
      loading = false;
      conversationHistory.splice(-1);
      vscode.window.showErrorMessage("Failed to fetch response, try again.");
      return;
    }

    conversationHistory.push({
      role: "assistant",
      text: response.output,
    });

    clearCurrentPrompt();

    loading = false;
  };

  const clearCurrentPrompt = () => {
    codePrompts = [];
    currentUserRequest = "";
    panel?.webview.postMessage({
      type: "userRequest",
      userRequest: "",
    });
  };

  const loadModels = async () => {
    if (!openAIKey) {
      vscode.window.showErrorMessage(
        "Failed to fetch models, please check your token"
      );
      return;
    }
    const response = await getModels(openAIKey);
    if (!response.ok) {
      vscode.window.showErrorMessage(
        "Failed to fetch models, please check your token"
      );
      return;
    }
    models = response.data
      .filter((m) => m.id.includes("gpt-"))
      .map((m) => m.id);
  };
  
  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.open", async () => {
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addFile", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompts,
        "file"
      );
      codePrompts = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addFunction", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompts,
        "function"
      );
      codePrompts = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addSelection", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompts,
        "selection"
      );
      codePrompts = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        lastActiveEditor = editor;
      }
    },
    null,
    context.subscriptions
  );
}

const buildPrompt = (codePrompt: CodePrompt[] | undefined, userRequest: string) => {
  return codePrompt
    ? `${promptToText(codePrompt)}\n# User request\n${userRequest}`
    : userRequest;
};

const promptToText = (prompt: CodePrompt[]) => {
  return prompt
    .map((p) => {
      const linedContent = addLineNumbers(p.content, "startLine" in p ? p.startLine ?? 0 : 0);
      if (p.type === "function") {
        return `# function "${p.name}" @ "${p.location}:${p.startLine}"\n${linedContent}\n`;
      } else if (p.type === "file") {
        return `# file @ "${p.location}" totalLines: ${p.totalLines}\n${linedContent}\n`;
      } else if (p.type === "selection") {
        return `# selection @ "${p.location}:${p.startLine}\n${linedContent}\n`;
      }
    })
    .join("\n");
};

const addLineNumbers = (text: string, startLine: number) => {
  return text
    .split("\n")
    .map((line, index) => `${startLine + index} ${line}`)
    .join("\n");
};


function createWebviewPanel(): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "promptmate",
    "PromptMate",
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = html;

  return panel;
}

export function deactivate() {}

