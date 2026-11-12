import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Strikethrough } from 'lucide-react';
import type { Strings } from './strings.js';

/**
 * O texto da gravação, editável.
 *
 * Por que um editor rico e não um `<textarea>`: o que se faz com uma
 * transcrição é grifar o que importa e mandar pra alguém. Texto puro perde isso
 * na primeira colagem, e negrito com asterisco é markdown que o Gmail não lê.
 *
 * Por que TipTap e não `contentEditable` na mão: ProseMirror por baixo. Ele
 * mantém um documento tipado e reconstrói o HTML a partir DELE, então o que sai
 * daqui só pode ser o que o schema permite. É por isso que o HTML gravado pode
 * voltar pra tela sem `dangerouslySetInnerHTML` e sem sanitizador nenhum: o que
 * não é parágrafo, negrito, itálico, riscado, título ou lista simplesmente não
 * sobrevive ao parse.
 *
 * A barrinha só aparece com texto selecionado. Uma régua de botões fixa em cima
 * de um texto que você abriu pra LER é ruído nas nove vezes em dez que você não
 * vai editar nada.
 */
export function TranscriptEditor({ html, editable, t, onChange, onReady }: {
  html: string;
  editable: boolean;
  t: Strings;
  onChange?: (html: string) => void;
  onReady?: (editor: Editor | null) => void;
}): JSX.Element {
  const ultimo = useRef(html);

  const editor = useEditor({
    editable,
    // Sem isto o React 18 em StrictMode monta duas vezes e o ProseMirror
    // reclama de hidratação. É o padrão recomendado pra SSR e não custa nada
    // aqui.
    immediatelyRender: false,
    extensions: [StarterKit],
    content: html,
    editorProps: { attributes: { class: 'transcript', spellcheck: 'false' } },
    onUpdate: ({ editor: e }) => {
      ultimo.current = e.getHTML();
      onChange?.(ultimo.current);
    },
  }, [editable]);

  useEffect(() => { onReady?.(editor); }, [editor, onReady]);

  // Conteúdo novo (outra gravação, ou o "voltar ao texto limpo") entra sem
  // disparar onUpdate: emitir a troca gravaria por cima da própria origem dela,
  // e o autosave entraria em laço.
  useEffect(() => {
    if (!editor || html === ultimo.current) return;
    ultimo.current = html;
    editor.commands.setContent(html, { emitUpdate: false });
  }, [html, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  return (
    <div style={{ marginTop: 10 }}>
      {editor && editable && (
        <BubbleMenu editor={editor}>
          <div style={{
            display: 'flex', gap: 2, padding: 3, borderRadius: 9,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}>
            <Botao on={editor.isActive('bold')} title={t.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13} /></Botao>
            <Botao on={editor.isActive('italic')} title={t.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13} /></Botao>
            <Botao on={editor.isActive('strike')} title={t.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={13} /></Botao>
            <Botao on={editor.isActive('bulletList')} title={t.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13} /></Botao>
            <Botao on={editor.isActive('orderedList')} title={t.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13} /></Botao>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function Botao({ on, title, onClick, children }: {
  on: boolean; title: string; onClick: () => void; children: React.ReactNode;
}): JSX.Element {
  return (
    <button className="seg" onClick={onClick} title={title} aria-label={title} aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 25,
        borderRadius: 7, border: 'none', cursor: 'pointer',
        background: on ? 'var(--surface-3)' : 'transparent',
        color: on ? 'var(--accent)' : 'var(--muted)',
      }}>
      {children}
    </button>
  );
}
