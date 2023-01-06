import { INotebookTracker } from '@jupyterlab/notebook';

export const PREFIX = 'awsgs:notebooks:';

export const NotebookEventType = {
  NotebookInitialize: `${PREFIX}NotebookInitialize`,
  NotebookStarted: `${PREFIX}NotebookStarted`,
  NotebookRequested: `${PREFIX}NotebookRequested`,
  NotebookResponse: `${PREFIX}NotebookResponse`,
  NotebookChange: `${PREFIX}NotebookChange`,
  NotebookLoadContent: `${PREFIX}NotebookLoadContent`,
  NotebookUnmount: `${PREFIX}NotebookUnmount`,
  NotebookRetry: `${PREFIX}NotebookRetry`
} as const;

export type NotebookEventTypeKeys = keyof typeof NotebookEventType;
export type NotebookEventTypeValue =
  typeof NotebookEventType[NotebookEventTypeKeys];

export interface NotebookCell {
  cell_type: string;
  execution_count: null;
  metadata: { trusted: boolean; editable: boolean; deletable?: boolean };
  outputs: [];
  source: string[] | string;
}
export interface NotebookModel {
  cells: NotebookCell[];
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: { display_name: string; language: string };
    language_info: {
      codemirror_mode: {
        name: string;
        version: number;
      };
      file_extension: string;
      mimetype: string;
      name: string;
    };
    orig_nbformat: number;
  };
}
export interface NotebookContainer {
  model: NotebookModel;
  source: string;
}

export interface NotebookData {
  notebookData: { model: string };
}

export interface PayloadModel {
  model: string;
  source: string;
}
export interface NotebookEventData {
  type: NotebookEventTypeValue;
  payload: string | NotebookData | PayloadModel;
}

export const send = (type: NotebookEventTypeValue, payload = '') => {
  const event: NotebookEventData = { type, payload };
  const parent = window.parent;
  parent.postMessage(event, '*');
};

export const receive = (
  message: MessageEvent,
  cb: (event: MessageEvent) => void
) => {
  cb(message);
};

const setInitializer = () => {
  /* Set initialized flag to true; without this flag no notebook change will be communicated to the iFrame host */
  const body = document.querySelector('body');
  body.dataset.glueInitialized = 'true';
};

export const onNotebookInitialize = (
  notebooks: INotebookTracker,
  payload: {
    notebookData: { model: string };
  }
) => {
  const { notebookData } = payload;
  const { model: payloadModel } = notebookData;
  const model = payloadModel ? JSON.parse(payloadModel) : {};

  notebooks.currentWidget.model.fromJSON(model);
  setInitializer();
};

/**
 * When this handler is invoked, it creates a payload with the current model behind the notebook
 * that the user is working with and a stringified version of the code that is in each cell. This
 * method does not assume that the script needs to be manipulated in any way. Can be simply considered
 * a getter for the current notebook state.
 *
 * Fires the {@link NotebookEventType.NotebookResponse} event.
 *
 * @param notebooks current notebook tracker
 */
export const onNotebookSent = (
  notebooks: INotebookTracker,
  eventType: NotebookEventTypeValue
) => {
  const model = notebooks.currentWidget?.model;
  const cells = model.cells;
  const source = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells.get(i);
    source.push(cell.value.text);
  }

  const payload = JSON.stringify({
    model: model.toJSON(),
    source: source.join('\n')
  });

  send(eventType, payload);
};

export const onNotebookRequested = (notebooks: INotebookTracker) => {
  onNotebookSent(notebooks, NotebookEventType.NotebookResponse);
};

export const onNotebookChange = (notebooks: INotebookTracker) => {
  onNotebookSent(notebooks, NotebookEventType.NotebookChange);
};

export const removeCookie = (name: string) => {
  const pathBits = location.pathname.split('/');
  let pathCurrent = ' path=';

  // do a simple pathless delete first.
  document.cookie = name + '=; expires=Thu, 01-Jan-1970 00:00:01 GMT;';

  for (let i = 0; i < pathBits.length; i++) {
    pathCurrent += (pathCurrent.substr(-1) !== '/' ? '/' : '') + pathBits[i];
    document.cookie =
      name + '=; expires=Thu, 01-Jan-1970 00:00:01 GMT;' + pathCurrent + ';';
  }
};

export const onNotebookUnmount = () => {
  console.info('Clearing cookies on unmount');
  ['cookieName', 'authToken', 'notebookId', 'userId', 'roleArn'].forEach(
    cookieName => {
      removeCookie(cookieName);
    }
  );
};

/**
 * When this handler is invoked, it receives a stringified payload with the model the user
 * is attempting to load into the notebook. This method can be simply considered
 * a setter for the current notebook nodel. When set it will return a stringified version of a
 * the notebook signal that's emited onContentChanged. {@link ISignal}
 *
 * Fires the {@link NotebookEventType.NotebookContentReceived} event.
 *
 * @param notebooks current notebook tracker
 */
export const onNotebookLoadContent = (
  notebooks: INotebookTracker,
  payload: { model: string; source: string }
) => {
  const model = JSON.parse(payload.model);
  notebooks.currentWidget.model.fromJSON(model);
};

/**
 * This is a global message handler for any "message" event that is coming from the parent container.
 * The set of events that this handler handles should only be the custom notebook events. Currently
 * there are no checks for the message event itself but if we needed to add some additional checks
 * on domain etc, that can be done on the message event before the "switch" cases kick in.
 *
 * @param message the message event received from the parent container
 * @param notebooks the current notebook tracker
 */
export const onNotebookEventReceived = (
  message: MessageEvent,
  notebooks: INotebookTracker
) => {
  const event = message.data as NotebookEventData;
  const { type, payload } = event;
  const {
    NotebookInitialize,
    NotebookRequested,
    NotebookChange,
    NotebookLoadContent,
    NotebookUnmount
  } = NotebookEventType;

  const { origin } = window.location;
  const jupyterConfigData = JSON.parse(
    document.getElementById('jupyter-config-data').textContent
  );

  /**
   * We call jupyter's contents API; while this call technically does nothing it will log the API call to console which will be
   * added to Cloudwatch where we will be able to query if needed.
   */
  fetch(
    `${origin}${jupyterConfigData.baseUrl}api/contents?postMessage=${type}&origin=${message.origin}`
  );

  switch (type) {
    /**
     * The idea for this event is that when the container is initializing the notebook, it can potentially send the state of a
     * previous notebook which can then be injected into the notebook that is currently starting as its model.
     */
    case NotebookInitialize:
      onNotebookInitialize(notebooks, payload as NotebookData);
      return;

    /**
     * This event is fired when the container window wants access to the current notebook
     * that the user is working with. A common use case is when the user clicks the "Save"
     * button in Glue Studio. The response captures the current code in the cells as strings
     * and also captures the current model of the notebook. This model can later be used to
     * initalize a notebook as well.
     */
    case NotebookRequested:
      onNotebookRequested(notebooks);
      return;

    /**
     * This event is fired when the container window wants to display content inside the current
     * notebook. A common use case is when the user opens a job in Glue Studio and we need to
     * display the retrieved notebook from S3.
     */
    case NotebookLoadContent:
      onNotebookLoadContent(notebooks, payload as PayloadModel);
      return;

    /**
     * This event is fired every time the notebook's content changes and allows us to keep state
     * an event stream of the notebook back to the host container.
     */
    case NotebookChange:
      onNotebookChange(notebooks);
      return;

    /**
     * This event is fired every time the notebook is unmounted on the Glue Studio side.
     * We will be using this for any clean up operation we need on the notebook side.
     */
    case NotebookUnmount:
      onNotebookUnmount();
      return;

    default:
      return;
  }
};
