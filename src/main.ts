import './ui/style.css';
import { startApp } from './ui/app';
import { runSplash } from './ui/splash';

// The studio card (index.html) is already on screen; the app initialises behind it.
const splashDone = runSplash();
startApp(document.getElementById('app')!, { splashDone });
