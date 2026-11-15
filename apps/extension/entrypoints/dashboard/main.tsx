import { render } from 'preact';
import { App } from '../../../web/src/App';
import '../../../web/src/styles.css';

const root = document.getElementById('root');
if (root) {
  render(<App />, root);
}
