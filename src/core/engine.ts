import { DefaultEventBus } from "./event-bus";
import {
  DefaultCommandRegistry,
  EditorRegistry,
  FormatRegistry,
  ToolRegistry,
} from "./registries";
import { editorCandidates, resolveEditor, type ResolveOptions } from "./resolve-editor";
import type {
  DetectInput,
  Disposable,
  EditorDescriptor,
  EditorResolution,
  FormatDescriptor,
  HostAPI,
  Notifications,
  ToolModule,
  UIContributions,
  Workspace,
} from "./types";

export interface EngineConfig {
  /** Id of the universal text fallback editor. */
  fallbackEditorId: string;
  preferredByFormat?: Record<string, string>;
}

/**
 * The Omnitext core. It owns the registries and event bus and hands each module a
 * scoped HostAPI. It imports no parser and no DOM editor widget: formats, editors,
 * and tools are registered from the outside (see src/main.ts).
 */
export class OmnitextEngine {
  readonly events = new DefaultEventBus();
  readonly commands = new DefaultCommandRegistry();
  readonly formats = new FormatRegistry();
  readonly editors = new EditorRegistry();
  readonly tools = new ToolRegistry();

  /** App-supplied sink for user-facing notifications; defaults to the console. */
  notificationSink: Notifications = {
    info: (m) => console.info("[omnitext]", m),
    warn: (m) => console.warn("[omnitext]", m),
    error: (m) => console.error("[omnitext]", m),
  };

  /** App-supplied workspace + UI providers; default no-ops until the app sets them. */
  workspace: Workspace = {
    getActiveDocument: () => null,
    setActiveText: () => {},
    getActiveBytes: () => Promise.resolve(null),
    setActiveBytes: () => {},
  };
  ui: UIContributions = {
    addToolbarButton: () => ({ dispose: () => {} }),
    openPanel: () => ({ close: () => {} }),
    closePanels: () => {},
  };

  constructor(private readonly config: EngineConfig) {}

  registerFormat(format: FormatDescriptor): Disposable {
    return this.formats.register(format);
  }

  registerEditor(editor: EditorDescriptor): Disposable {
    return this.editors.register(editor);
  }

  /** Register and immediately activate a tool, returning its teardown disposable. */
  registerTool(tool: ToolModule): Disposable {
    const reg = this.tools.register(tool);
    const active = tool.activate(this.host(tool.manifest.id));
    return {
      dispose: () => {
        active.dispose();
        reg.dispose();
      },
    };
  }

  detect(input: DetectInput): { descriptor: FormatDescriptor; confidence: number } | null {
    return this.formats.detect(input);
  }

  resolve(format: FormatDescriptor | null): EditorResolution {
    const opts: ResolveOptions = {
      fallbackEditorId: this.config.fallbackEditorId,
      preferredByFormat: this.config.preferredByFormat,
    };
    return resolveEditor(format, this.editors, opts);
  }

  /** All editors that can render this document (for the editor switcher UI). */
  editorChoices(format: FormatDescriptor | null): EditorResolution[] {
    return editorCandidates(format, this.editors, this.config.fallbackEditorId);
  }

  /** Build the scoped capability object handed to a module. */
  host(moduleId: string): HostAPI {
    return {
      moduleId,
      events: this.events,
      commands: this.commands,
      formats: this.formats,
      editors: this.editors,
      tools: this.tools,
      notifications: this.notificationSink,
      workspace: this.workspace,
      ui: this.ui,
    };
  }
}
