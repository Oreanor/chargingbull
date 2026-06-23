import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';

/** Build-time SSG entry: render the longread to an HTML string that the prerender
 *  script injects into index.html. Heavy WebGL chapters are client-only, so on the
 *  server this emits the text + section shells (with their fixed heights) only. */
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
