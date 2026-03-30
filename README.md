# Excalidraw VS Code Fork

> **Note:** This is a fork of the excellent [excalidraw-vscode](https://github.com/excalidraw/excalidraw-vscode) extension by [pomdtr](https://github.com/pomdtr). All credit for the original integration goes to pomdtr and the entire [Excalidraw](https://excalidraw.com/) team. This fork adds additional functionality for automatic frame exporting.

Read more about the motivation here: https://blog.lysk.tech/excalidraw-frame-export/

## New Feature: Auto-Export Named Frames

This fork adds automatic SVG export for Excalidraw frames, making it especially useful for documentation and blog posts.

### How It Works

Simply wrap the elements you want to export in a frame and name it with the `export_` prefix:

1. **Create a frame** around your diagram elements
2. **Name it** using the pattern: `export_your_image_name`
3. **That's it!** The extension automatically exports two SVG files next to your `.excalidraw` file:
   - `your_image_name.light.exp.svg` (light mode version)
   - `your_image_name.dark.exp.svg` (dark mode version)

### Why This Exists

When writing blog posts with Excalidraw diagrams, the original workflow required 9 manual steps every time you made a change:
1. Select the frame
2. Press export
3. Choose the right name + dark/light mode postfix
4. Export
5. Switch light/dark mode
6. Choose the right name again
7. Export again
8. Realize one label crossed the frame boundary
9. Start all over again (about 45 seconds per iteration!)

This fork eliminates that friction. Now when you edit an Excalidraw file in VS Code, the exported SVGs update automatically as you work—perfect for live preview in markdown files.

### Example Use Case

For blog posts, you can reference the auto-exported images:
````markdown
![My diagram](./my-diagram.dark.exp.svg#gh-dark-mode-only)
![My diagram](./my-diagram.light.exp.svg#gh-light-mode-only)
````

The images update instantly when you modify the frame in Excalidraw, with no manual export step needed.

### Installation

You can install this fork from the [Releases](https://github.com/martin-lysk/excalidraw-vscode/releases) section:

1. Go to the [Releases page](https://github.com/martin-lysk/excalidraw-vscode/releases)
2. Download the latest `.vsix` file
3. In VS Code, open the Extensions panel (Cmd+Shift+X on Mac, Ctrl+Shift+X on Windows/Linux)
4. Click the "..." menu in the Extensions panel
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

---

# Excalidraw

This extension integrates Excalidraw into VS Code.
To use it, create an empty file with a `.excalidraw`, `.excalidraw.json`, `.excalidraw.svg` or `.excalidraw.png` extension and open it in Visual Studio Code.

Try the web version at : <https://excalidraw.com/>

![demo](./medias/screenshot.png)

- [Features](#features)
  - [Edit Images](#edit-images)
  - [Draw from your browser](#draw-from-your-browser)
  - [Switch Editor Theme](#switch-editor-theme)
  - [Import Public Library](#import-public-library)
  - [View Drawing Source](#view-drawing-source)
  - [Associate Additional Extensions with the Excalidraw Editor](#associate-additional-extensions-with-the-excalidraw-editor)
  - [Sharing your Library](#sharing-your-library)
  - [Configure Language](#configure-language)
- [Contact](#contact)
- [Note for Contributors](#note-for-contributors)

## Features

### Edit Images

The source of the drawing can be embedded directly in a PNG or SVG image. Just create a new `.excalidraw.png` or `.excalidraw.svg` file.
You can also switch between text and image format by updating the file extension (ex: rename a `.excalidraw` file to `.excalidraw.png`).

![Image can be edited directly](./medias/edit_image.gif)

You can control the default export options using the `excalidraw.image` setting:

```json
{
  "excalidraw.image": {
    "exportScale": 1,
    "exportWithBackground": true,
    "exportWithDarkMode": false
  }
}
```

### Draw from your browser

You can install this extension in [`github.dev`](https://github.dev) or [`vscode.dev`](https://vscode.dev).
Editing an Excalidraw schema stored in a GitHub repository has never been easier !

### Switch Editor Theme

The extension support three theme options:

- light (default)
- dark
- auto (sync with VS Code Theme)

![theme switching](./medias/change-theme.gif)

### Import Public Library

Check out the available libraries at [libraries.excalidraw.com](https://libraries.excalidraw.com), and don't hesitate to contribute your own !

![Public libraries can be imported from the browser](./medias/import-library.gif)

### View Drawing Source

You can switch between the Excalidraw editor and the source (text or image) using the editor toolbar.

![Use the dedicated toolbar button to view the diagram source](./medias/view_source.gif)

### Associate Additional Extensions with the Excalidraw Editor

By default, this extension only handles `*.excalidraw`, `*.excalidraw.svg` and `*.excalidraw.png` files.

Add this to your VS Code `settings.json` file if you want to associate it with additional file extensions (ex: SVG):

```json
{
  "workbench.editorAssociations": {
    "*.svg": "editor.excalidraw"
  }
}
```

You won't be able to edit arbitrary SVG files though - only those that have been created with Excalidraw or this extension!

### Sharing your Library

If you want to use a workspace specific library (and share it with other contributors), set the `excalidraw.workspaceLibraryPath` in your Visual Studio Code workspace settings file (`.vscode/settings.json`):

```json
{
  "excalidraw.workspaceLibraryPath": "path/to/library.excalidrawlib"
}
```

The `workspaceLibraryPath` path is relative to your workspace root. Absolute path are also supported, but it will be specific to your device.

### Configure Language

By default, the extension will use the [Visual Studio Code Display Language](https://code.visualstudio.com/docs/getstarted/locales) to determine the language to use. You can overwrite it using the `excalidraw.language` setting:

```json
{
  "excalidraw.language": "fr-FR"
}
```

## Contact

Only bug reports / feature requests specifics to the VS Code integration should go to the extension repository. If it is not the case, please report your issue directly to the Excalidraw project.

## Note for Contributors

Thank you for considering contributing to the extension :sparkling_heart: !

This extension only goal is to integrate Excalidraw to the Visual Studio Code ecosystem. Users should be able to use both the website and the extension with a minimal amount of friction. As such, we will not accept any contribution that significantly modify the user experience compared to the Excalidraw website.

There are exceptions to this rule (for example, the switch theme icon was deported to Visual Studio Code editor toolbar to allow a better integration). In case of uncertainty, create a thread in the project [Discussion Page](https://github.com/excalidraw/excalidraw-vscode/discussions).
