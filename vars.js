import * as inspector from "node:inspector/promises";

// https://nodejs.org/docs/latest-v19.x/api/inspector.html
// https://chromedevtools.github.io/devtools-protocol/v8/Debugger
// https://chromedevtools.github.io/devtools-protocol/v8/Runtime

export class LocalVariables {
  static id = "LocalVariables";

  name = LocalVariables.id;
  props = null;

  constructor() {
    this.session = new inspector.Session();
    this.session.connect();

    this.session.on("Debugger.paused", async ({ params }) => {
      // TODO: Exceptions only for now
      // if (params.reason == "promiseRejection" || params.reason == "exception") {
      if (params.reason == "exception") {
        // TODO: Handle all frames
        const topFrame = params.callFrames[0];
        const local = topFrame.scopeChain.find(
          (scope) => scope.type === "local"
        );
        if (!local) {
          console.log("no local scope");
          return;
        }

        console.log("Runtime.getProperties");

        const localProps = (
          await this.session.post("Runtime.getProperties", {
            objectId: local.object.objectId,
            ownProperties: true,
          })
        ).result;

        const rv = {};

        for (const prop of localProps) {
          if (prop.value.className === "Array") {
            rv[prop.name] = (
              await this.session.post("Runtime.getProperties", {
                objectId: prop.value.objectId,
                ownProperties: true,
              })
            ).result
              .filter((v) => v.name !== "length")
              .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
              .map((v) => v.value.value);
          } else if (prop.value.className === "Object") {
            rv[prop.name] = Object.fromEntries(
              (
                await this.session.post("Runtime.getProperties", {
                  objectId: prop.value.objectId,
                  ownProperties: true,
                })
              ).result.map((v) => [v.name, v.value.value])
            );
          } else {
            rv[prop.name] = prop.value.value || `<${prop.value.description}>`;
          }
        }

        console.log(rv);
        this.props = rv;
      }
    });

    this.session.post("Debugger.enable");
    this.session.post("Debugger.setPauseOnExceptions", { state: "all" });
  }

  setupOnce(addGlobalEventProcessor) {
    addGlobalEventProcessor(async (event) => {
      return this.addSourceContext(event);
    });
  }

  async addSourceContext(event) {
    // TODO: Handle all frames
    event.exception.values[0].stacktrace.frames.reverse()[0].vars = {
      ...this.props,
    };
    return event;
  }
}
