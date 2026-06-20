import type {
  CommandDescriptor,
  CommandRegistry,
  DetectInput,
  Disposable,
  EditorModule,
  EditorRegistryReadonly,
  FormatModule,
  FormatRegistryReadonly,
  ToolModule,
  ToolRegistryReadonly,
  ViewKind,
} from "./types";

function normalizeExt(ext: string): string {
  const e = ext.toLowerCase();
  return e.startsWith(".") ? e : "." + e;
}

export class FormatRegistry implements FormatRegistryReadonly {
  private readonly byIdMap = new Map<string, FormatModule>();

  register(format: FormatModule): Disposable {
    const id = format.manifest.id;
    if (this.byIdMap.has(id)) throw new Error(`format "${id}" already registered`);
    this.byIdMap.set(id, format);
    return { dispose: () => this.byIdMap.delete(id) };
  }

  byId(id: string): FormatModule | undefined {
    return this.byIdMap.get(id);
  }

  byExtension(ext: string): FormatModule[] {
    const want = normalizeExt(ext);
    return this.list().filter((f) =>
      f.manifest.extensions.some((e) => normalizeExt(e) === want),
    );
  }

  /** Extension match is a strong prior; content sniff (detect) breaks ties. */
  detect(input: DetectInput): { format: FormatModule; confidence: number } | null {
    let best: { format: FormatModule; confidence: number } | null = null;
    for (const format of this.byIdMap.values()) {
      let confidence = format.detect(input);
      if (input.filename) {
        const dot = input.filename.lastIndexOf(".");
        if (dot >= 0) {
          const ext = normalizeExt(input.filename.slice(dot));
          if (format.manifest.extensions.some((e) => normalizeExt(e) === ext)) {
            confidence = Math.max(confidence, 0.95);
          }
        }
      }
      if (confidence > 0 && (!best || confidence > best.confidence)) {
        best = { format, confidence };
      }
    }
    return best;
  }

  list(): FormatModule[] {
    return [...this.byIdMap.values()];
  }
}

export class EditorRegistry implements EditorRegistryReadonly {
  private readonly byIdMap = new Map<string, EditorModule>();

  register(editor: EditorModule): Disposable {
    const id = editor.manifest.id;
    if (this.byIdMap.has(id)) throw new Error(`editor "${id}" already registered`);
    this.byIdMap.set(id, editor);
    return { dispose: () => this.byIdMap.delete(id) };
  }

  byId(id: string): EditorModule | undefined {
    return this.byIdMap.get(id);
  }

  consumersOf(view: ViewKind): EditorModule[] {
    return this.list().filter((e) => e.manifest.consumesViews.includes(view));
  }

  list(): EditorModule[] {
    return [...this.byIdMap.values()];
  }
}

export class ToolRegistry implements ToolRegistryReadonly {
  private readonly byIdMap = new Map<string, ToolModule>();

  register(tool: ToolModule): Disposable {
    const id = tool.manifest.id;
    if (this.byIdMap.has(id)) throw new Error(`tool "${id}" already registered`);
    this.byIdMap.set(id, tool);
    return { dispose: () => this.byIdMap.delete(id) };
  }

  byId(id: string): ToolModule | undefined {
    return this.byIdMap.get(id);
  }

  list(): ToolModule[] {
    return [...this.byIdMap.values()];
  }
}

export class DefaultCommandRegistry implements CommandRegistry {
  private readonly cmds = new Map<string, CommandDescriptor>();

  register(cmd: CommandDescriptor): Disposable {
    if (this.cmds.has(cmd.id)) throw new Error(`command "${cmd.id}" already registered`);
    this.cmds.set(cmd.id, cmd);
    return { dispose: () => this.cmds.delete(cmd.id) };
  }

  async execute(id: string, ...args: unknown[]): Promise<unknown> {
    const cmd = this.cmds.get(id);
    if (!cmd) throw new Error(`unknown command "${id}"`);
    return cmd.run(...args);
  }

  list(): CommandDescriptor[] {
    return [...this.cmds.values()];
  }
}
