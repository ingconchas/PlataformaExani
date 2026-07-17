"use client";

import { type ReactNode, useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import HardBreak from "@tiptap/extension-hard-break";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { UndoRedo } from "@tiptap/extensions";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Subscript as SubIcon,
  Superscript as SupIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Extensiones INDIVIDUALES alineadas a la whitelist de `convex/sanitizar.ts` (NO
// StarterKit, que trae headings/listas/links/code). `getHTML()` emite solo
// strong/em/sup/sub/p/br → nada que perder al sanear.
const EXTENSIONES = [
  Document,
  Paragraph,
  Text,
  Bold, // <strong>
  Italic, // <em>
  Superscript, // <sup>
  Subscript, // <sub>
  HardBreak, // <br>
  UndoRedo, // en v3 `History` se llama UndoRedo
];

/** Símbolos frecuentes en reactivos de matemáticas (se insertan como texto). */
const SIMBOLOS = ["Ω", "π", "±", "×", "÷", "√", "≤", "≥", "≠", "∞", "°", "²", "³"];

/**
 * Editor de texto enriquecido (TipTap v3) para el enunciado y la explicación de un
 * reactivo (LUI-15 E2). Persiste HTML; el saneo real es server-side (`convex/sanitizar`),
 * este editor es UX + saneador #2 en lectura.
 *
 * **NO CONTROLADO**: `value` se lee UNA sola vez al montar (el form lo monta con
 * `key={reactivoId}`); `onChange` emite el HTML en cada cambio. Nunca se hace
 * `setContent` desde el estado externo → sin loop ni saltos de cursor.
 */
export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: EXTENSIONES,
    content: value,
    immediatelyRender: false, // gotcha SSR de Next App Router
    editable: !disabled,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        class: "min-h-[80px] px-3 py-2.5 text-body text-ink focus:outline-none",
      },
    },
  });

  // El candado/solo-lectura puede cambiar `disabled` reactivamente.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // En v3 el rerender por transacción no es automático → suscribir el estado activo.
  const activo = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      sup: editor?.isActive("superscript") ?? false,
      sub: editor?.isActive("subscript") ?? false,
    }),
  });

  const insertar = (s: string) => editor?.chain().focus().insertContent(s).run();

  return (
    <div
      role="group"
      aria-label={`Editor: ${ariaLabel}`}
      className={cn(
        "rounded-control border-[1.5px] border-border-strong bg-surface",
        disabled && "bg-disabled-bg opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-1 rounded-t-control border-b border-border bg-bg px-1.5 py-1.5">
        <TbBtn
          label="Negrita"
          activo={activo?.bold}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <BoldIcon className="size-[15px]" aria-hidden />
        </TbBtn>
        <TbBtn
          label="Cursiva"
          activo={activo?.italic}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon className="size-[15px]" aria-hidden />
        </TbBtn>
        <TbBtn
          label="Superíndice"
          activo={activo?.sup}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleSuperscript().run()}
        >
          <SupIcon className="size-[15px]" aria-hidden />
        </TbBtn>
        <TbBtn
          label="Subíndice"
          activo={activo?.sub}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleSubscript().run()}
        >
          <SubIcon className="size-[15px]" aria-hidden />
        </TbBtn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {SIMBOLOS.map((s) => (
          <TbBtn
            key={s}
            label={`Insertar ${s}`}
            disabled={disabled}
            onClick={() => insertar(s)}
          >
            <span className="text-[13px] font-semibold">{s}</span>
          </TbBtn>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function TbBtn({
  label,
  activo = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  activo?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={activo}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // no robar el foco del editor
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors",
        activo ? "bg-unx-blue-tint text-unx-blue" : "text-muted hover:bg-disabled-bg",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
