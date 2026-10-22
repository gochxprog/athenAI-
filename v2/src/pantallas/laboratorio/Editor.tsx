// Editor de código (CodeMirror 6, ~150 KB): Python con resaltado, números de línea y deshacer, en el negro de la v2.
import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const tema = EditorView.theme(
  {
    '&': { color: '#e6e7ea', backgroundColor: 'transparent', height: '100%', fontSize: '12.5px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65' },
    '.cm-content': { caretColor: '#fff', padding: '12px 0' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#45484e', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.035)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(255,255,255,.14) !important' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: '#fff' },
  },
  { dark: true },
);
// Gris y blanco: palabras clave en blanco, comentarios apagados, números y textos en plata.
const colores = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword], color: '#ffffff', fontWeight: '600' },
  { tag: [t.comment], color: '#5a5e66', fontStyle: 'italic' },
  { tag: [t.string, t.number, t.bool], color: '#b8bbc2' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#d9dbdf' },
  { tag: [t.operator, t.punctuation], color: '#8e929a' },
]);

export default function Editor({ codigo, cambiar }: { codigo: string; cambiar: (c: string) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const vista = useRef<EditorView | null>(null);
  const alCambiar = useRef(cambiar);
  alCambiar.current = cambiar;

  useEffect(() => {
    const v = new EditorView({
      doc: codigo,
      parent: caja.current!,
      extensions: [basicSetup, python(), tema, syntaxHighlighting(colores), EditorView.updateListener.of((u) => u.docChanged && alCambiar.current(u.state.doc.toString()))],
    });
    vista.current = v;
    return () => v.destroy();
    // El editor se crea una vez; los cambios de plantilla entran por el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = vista.current;
    if (v && v.state.doc.toString() !== codigo) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: codigo } });
  }, [codigo]);

  return <div ref={caja} className="editor" />;
}
