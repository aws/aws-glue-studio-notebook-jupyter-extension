import {
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, IThemeManager } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ITranslator } from '@jupyterlab/translation';
import {
  NotebookEventType,
  onNotebookChange,
  onNotebookEventReceived,
  onNotebookRequested,
  send
} from './events';
import { kernels } from './kernels';

const cellNodes = new Set();
const activate = (
  app: JupyterFrontEnd,
  labShell: ILabShell,
  documentManager: IDocumentManager,
  notebookTracker: INotebookTracker,
  commandPalette: ICommandPalette,
  themeManager: IThemeManager,
  translator: ITranslator
): void => {
  const trans = translator.load('jupyterlab');
  const style = '@amzn/awsgluenotebooks-extensions/style/index.css';

  themeManager.register({
    name: 'Glue Studio UI Light',
    displayName: trans.__('Glue Studio UI Light'),
    isLight: true,
    load: () => themeManager.loadCSS(style),
    unload: () => Promise.resolve(undefined)
  });

  // TODO: The script name should be coming from iFrame communication; so we need to populate that here.
  const temporaryScriptName = '/Untitled.ipynb';
  labShell.mode = 'single-document';

  app.started
    .then(() => {
      // We are setting #glue-base because we don't want to create a jupyterlab override file for the theming
      // Instead we just have higher specificity and forget about the override; our theme will kick-in since it's all-in-one.
      // We can rework this later after release once we split this into multiple extensions.
      const body = document.querySelector('body');
      body?.setAttribute('id', 'glue-base');
      body?.classList.add('aws-fake-loader');

      documentManager.createNew(temporaryScriptName, 'default', {
        name: kernels.gluePySpark
      });
    })
    .then(() => {
      /* Beware, horrible hacky implementation
      When launching the app from scratch the kernel will be selected when we create a new document but for some reason the kernel
      selector will still show up.
      
      So this is what we do:
      1. When the app is started we add a class with visibility: hidden to the body. This will allow jupyter to still calculate the layout while not showing anything on-screen.
      2. Once the notebook has been attached we click on the modalOverlay programatically to dismiss it.
      3. Once the modal has been clicked we remove the visibility: hidden class.
      */
      const body = document.querySelector('body');

      notebookTracker.widgetAdded.connect(
        async (tracker: INotebookTracker, notebookPanel: NotebookPanel) => {
          await notebookPanel.revealed;
          await notebookPanel.sessionContext.ready;
          const modalOverlay = document.querySelector(
            '.lm-Widget.p-Widget.jp-Dialog'
          ) as HTMLElement | undefined;
          modalOverlay?.click();
          body.classList.remove('aws-fake-loader');

          /**
           * Remove the "Save" button. We dont want the users saving to disk.
           */
          const addBtnText = 'Save the notebook contents and create checkpoint';
          const addBtnSelector = `[title="${addBtnText}"]`;
          document.querySelector(addBtnSelector).parentElement.remove();

          const buttonContainer = document.querySelector(
            '.lm-Widget.p-Widget.jp-Toolbar-spacer.jp-Toolbar-item'
          );
          const downloadButton = document.createElement('button');
          downloadButton.innerText = 'Download';
          downloadButton.classList.add('glue__download-button');

          downloadButton.onclick = () => onNotebookRequested(tracker);
          buttonContainer.appendChild(downloadButton);

          /* NOTE: Try this if you need to run content programatically */
          // NotebookActions.run(
          //   notebookPanel.content,
          //   notebookPanel.sessionContext
          // );
        }
      );
    });

  /**
   * Every time the notebook changes we send it to Glue Studio to keep track of its state.
   * But only after the notebook has been initialized.
   */
  notebookTracker.activeCellChanged.connect(async (tracker, cell) => {
    const body = document.querySelector('body');
    // Note: Datasets only store string values that's why we compare against a string
    if (body.dataset.glueInitialized === 'true' && !cellNodes.has(cell.node)) {
      onNotebookChange(tracker);

      const cb = () => {
        onNotebookChange(tracker);
      };

      cell.model.contentChanged.connect(cb);
      cellNodes.add(cell.node);
    }
  });

  /**
   * This event is fired once the current notebook widget is loaded. In the container
   * window, if the iframe is rendered without the notebook widget, the users will see an
   * empty screen. This event allows the container window to show a loading status
   * till the actual notebook widget is available so that the users can see the fully rendered
   * notebook.
   */
  notebookTracker.widgetAdded.connect(async (tracker, notebookPanel) => {
    await notebookPanel.revealed;
    await notebookPanel.sessionContext.ready;
    send(NotebookEventType.NotebookStarted);
  });

  /**
   * Handle notebook events that might be sent from the container window.
   * This should be handy when wanting to load notebook contents coming from Glue Studio.
   */
  notebookTracker.widgetAdded.connect(async (tracker, notebookPanel) => {
    await notebookPanel.revealed;
    await notebookPanel.sessionContext.ready;

    window.addEventListener('message', message =>
      onNotebookEventReceived(message, tracker)
    );
  });
};

/**
 * Initialization data for the awsgs-ui extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: '@amzn/awsgluenotebooks-extensions:plugin',
  autoStart: true,
  requires: [
    ILabShell,
    IDocumentManager,
    INotebookTracker,
    ICommandPalette,
    IThemeManager,
    ITranslator
  ],
  activate: activate
};

export default extension;
