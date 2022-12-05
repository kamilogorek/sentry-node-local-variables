import * as Sentry from "@sentry/node";
import { LocalVariables } from "./vars.js";

Sentry.init({
  dsn: "https://5b0e5845265a472ba9c269bbfa0c8388@o333688.ingest.sentry.io/5334254",
  integrations: [new LocalVariables()],
  beforeSend(event) {
    console.log(event.exception.values[0].stacktrace.frames[0]);
    return event;
  },
});

function wat() {
  const crew = ["secret-santa", "deer", "elf"];
  greet(
    {
      prefix: "Hello",
    },
    crew
  );
}

function greet(options, crew) {
  const elite = 1337;
  const word = "there";
  throw new Error(`${options.prefix} ${crew.join(",")} ${word} #${elite}`);
}

(() => {
  const localVariable = 123;
  wat();
})();
