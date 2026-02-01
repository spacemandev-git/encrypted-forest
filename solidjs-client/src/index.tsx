/* @refresh reload */
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { render } from "solid-js/web";
import App from "./App.js";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(() => <App />, root);
