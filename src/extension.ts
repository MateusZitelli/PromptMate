import * as vscode from "vscode";
import { micromark } from "micromark";
import {parseLine, Command, parseCommands} from "./commands/parse";
import "dotenv/config";
import html from "./index.html";
import { askGPT, getModels } from "./services";
import { createExecuteCommands, Message } from "./commands/execute";
import { handleAddPromptEvent, CodePrompt as CodePrompt } from "./prompt";


// This project is a VS Code extension that implements your commands. Explore the project and implement a @find command to search text in the workspace at the file prompt-mate/src/extension.ts.

export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;
  let conversationHistory: Message[] = [];
  let codePrompts: CodePrompt[] = [];
  let lastActiveEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  let currentUserRequest = "";
  let models: string[] = [];
  let token: string | undefined = context.globalState.get(
    "openaiUserToken",
    ""
  );
  let renderMarkdown = true;
  let model = context.globalState.get("openaiModel", "gpt-3.5-turbo");
  let loading = false;
  let lastConversationLength = 0;
  let memory = "";

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
      if (message.type === "askGPT" && !loading && token) {
        await handleAskGPTEvent(message);
      } else if (message.type === "updateToken") {
        context.globalState.update("openaiUserToken", message.token);
        token = message.token;
        await loadModels();
      } else if (message.type === "updateModel") {
        context.globalState.update("openaiModel", message.model);
        model = message.model;
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
        if (token) {
          await loadModels();
        }
      } else if (message.type === "clearConversation") {
        conversationHistory = [];
      }else if (message.type === "toggleMarkdown") { 
        handleToggleMarkdownEvent();
      }else if (message.type === "deleteMessage") {
        conversationHistory.splice(message.index, 1);
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
    await panel?.webview.postMessage({ type: "token", token });
    await panel?.webview.postMessage({
      type: "currentFullPrompt",
      fullPrompt: buildPrompt(codePrompts, currentUserRequest),
    });
    await panel?.webview.postMessage({ type: "model", model });
    await panel?.webview.postMessage({ type: "models", models });
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

    const response = await askGPT(
      message.token,
      conversationHistory.map((m) => ({
        role: m.role,
        content: buildPrompt(m.codePrompt, m.text),
      })),
      model
    );

    if (!response.ok) {
      conversationHistory.splice(-1);
      if (response.code === "context_length_exceeded") {
        vscode.window.showErrorMessage(
          "Conversation length exceeded, remove some messages."
        );
      } else {
        vscode.window.showErrorMessage("Failed to fetch response, try again.");
      }
      return;
    }

    conversationHistory.push({
      role: "assistant",
      text: response.data,
    });

    clearCurrentPrompt();

    const agentCommandsResult = await handleAgentCommands(response.data);

    loading = false;

    if (!agentCommandsResult.ok) {
      return;
    }

    if ((currentUserRequest.length > 0 || codePrompts.length > 0) && !error) {
      await handleAskGPTEvent({
        token: message.token,
        userRequest: currentUserRequest,
        codePrompt: [...codePrompts],
      });
    }
  };
  
  const handleAgentCommands = async (data: string) => {
    const executeCommands = createExecuteCommands({
      state: {
        codePrompts,
        currentUserRequest,
        editor: vscode.window.activeTextEditor ?? lastActiveEditor,
        panel,
        memory,
        conversationHistory,
      },
      actions: {
        loadUI,
      },
    });

    try {
      // Execute the commands from the AI response.
      const commands = parseCommands(data);
      const newContext = await executeCommands(commands);
      codePrompts = newContext.codePrompts;
      currentUserRequest = newContext.currentUserRequest;
      lastActiveEditor = newContext.editor;
      return {ok: true};
    } catch (e) {
      if (e instanceof Error) {
        currentUserRequest += e.message;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        vscode.window.showErrorMessage("Command error");
        console.error(e);
      } else {
        throw e;
      }
      return {
        ok: false
      };
    }
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
    if (!token) {
      vscode.window.showErrorMessage(
        "Failed to fetch models, please check your token"
      );
      return;
    }
    const response = await getModels(token);
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

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.runCommand", async () => {
      const command = await vscode.window.showInputBox({
        prompt: "Enter a command",
      });

      if(!command){
        return;
      }
      const parsedLine = parseLine(command);
      
      if(!parsedLine){
        return;
      }

      const [name, args] = parsedLine;
      
      const executeCommands = createExecuteCommands({
        state: {
          codePrompts,
          currentUserRequest,
          editor: vscode.window.activeTextEditor ?? lastActiveEditor,
          panel,
          memory,
          conversationHistory,
        },
        actions: {
          loadUI,
        },
      });

      await executeCommands([new Command(name, args)]);
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
      const linedContent = addLineNumbers(p.content, "startLine" in p ? p.startLine : 0);
      if (p.type === "function") {
        return `# function "${p.name}" @ "${p.location}:${p.startLine}"\n${linedContent}\n`;
      } else if (p.type === "file") {
        return `# file @ "${p.location}"\n${linedContent}\n`;
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

