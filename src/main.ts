import './ui/style.css';
import { startApp } from './ui/app';
import { showSplash } from './ui/splash';

const splashDone = showSplash(document.body);
startApp(document.getElementById('app')!, { splashDone });
