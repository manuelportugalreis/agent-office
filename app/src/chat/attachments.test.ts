import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "../../../shared/protocol";
import { uploadFile, uploadUrl } from "../net/upload";
import { createUploadAdapter } from "./attachments";

const file = (name = "vaga.md", content = "# vaga") => new File([content], name, { type: "text/markdown" });

describe("adaptador de anexos", () => {
  it("envia o ficheiro ao escolher e usa o nome devolvido pelo servidor", async () => {
    const upload = vi.fn().mockResolvedValue({ name: "vaga (2).md" });
    const adapter = createUploadAdapter("lena", { upload, notify: vi.fn() });
    const pending = (await adapter.add({ file: file() })) as { name: string; status: unknown };
    expect(upload).toHaveBeenCalledWith("lena", expect.any(File));
    expect(pending).toMatchObject({ name: "vaga (2).md", type: "file", status: { type: "requires-action" } });
  });
  it("ao enviar a mensagem, o anexo fica completo", async () => {
    const adapter = createUploadAdapter("lena", { upload: vi.fn().mockResolvedValue({ name: "a.md" }), notify: vi.fn() });
    const pending = (await adapter.add({ file: file("a.md") })) as Parameters<typeof adapter.send>[0];
    await expect(adapter.send(pending)).resolves.toMatchObject({ name: "a.md", status: { type: "complete" } });
  });
  it("avisa o utilizador quando o envio falha ou o servidor dá uma nota", async () => {
    const notify = vi.fn();
    const failing = createUploadAdapter("lena", {
      upload: vi.fn().mockRejectedValue(new Error("Este tipo de ficheiro não é aceite.")),
      notify,
    });
    await expect(failing.add({ file: file("x.exe") })).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith("Este tipo de ficheiro não é aceite.");
    const withNote = createUploadAdapter("lena", {
      upload: vi.fn().mockResolvedValue({ name: "a.docx", note: "Não consegui converter." }),
      notify,
    });
    await withNote.add({ file: file("a.docx") });
    expect(notify).toHaveBeenCalledWith("Não consegui converter.");
  });
});

describe("uploadFile", () => {
  it("codifica o nome e o agente no URL", () => {
    expect(uploadUrl("lena", "relatório final (v2).pdf")).toBe(
      "http://127.0.0.1:8787/upload?agent=lena&name=relat%C3%B3rio%20final%20(v2).pdf",
    );
  });
  it("devolve o nome guardado e propaga erros do servidor em português", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ name: "a.md", bytes: 3 }), { status: 200 })));
    await expect(uploadFile("lena", file("a.md", "abc"))).resolves.toEqual({ name: "a.md", bytes: 3, note: undefined });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Este tipo de ficheiro (executável ou script) não é aceite." }), { status: 415 }),
        ),
    );
    await expect(uploadFile("lena", file("x.exe"))).rejects.toThrow("não é aceite");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")));
    await expect(uploadFile("lena", file())).rejects.toThrow("servidor está offline");
    vi.unstubAllGlobals();
  });
  it("recusa ficheiros com mais de 10 MB sem os enviar", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const big = { name: "grande.pdf", size: MAX_UPLOAD_BYTES + 1 } as File;
    await expect(uploadFile("lena", big)).rejects.toThrow("10 MB");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
