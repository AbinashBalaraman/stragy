import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ChatKitPage} from './components/qa/ChatKitPage.tsx';
import './index.css';

// QA-only preview: reachable by query string, never linked from the app nav.
const isChatKit = new URLSearchParams(window.location.search).get('qa') === 'chat-kit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isChatKit ? <ChatKitPage /> : <App />}
  </StrictMode>,
);
