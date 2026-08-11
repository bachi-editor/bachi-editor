import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/tokens.css';
import './styles/components.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
