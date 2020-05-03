/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IRenderDimensions, IRenderLayer } from 'browser/renderer/Types';
import { ICellData } from 'common/Types';
import { DEFAULT_COLOR, WHITESPACE_CELL_CHAR, WHITESPACE_CELL_CODE, Attributes } from 'common/buffer/Constants';
import { IGlyphIdentifier } from 'browser/renderer/atlas/Types';
import { DIM_OPACITY, INVERTED_DEFAULT_COLOR } from 'browser/renderer/atlas/Constants';
import { BaseCharAtlas } from 'browser/renderer/atlas/BaseCharAtlas';
import { acquireCharAtlas } from 'browser/renderer/atlas/CharAtlasCache';
import { AttributeData } from 'common/buffer/AttributeData';
import { IColorSet, IColor } from 'browser/Types';
import { CellData } from 'common/buffer/CellData';
import { IBufferService, IOptionsService } from 'common/services/Services';
import { throwIfFalsy } from 'browser/renderer/RendererUtils';
import { channels, color, rgba } from 'browser/Color';

export abstract class BaseRenderLayer implements IRenderLayer {
  private _canvas: HTMLCanvasElement;
  protected _ctx!: CanvasRenderingContext2D;
  private _scaledCharWidth: number = 0;
  private _scaledCharHeight: number = 0;
  private _scaledCellWidth: number = 0;
  private _scaledCellHeight: number = 0;
  private _scaledCharLeft: number = 0;
  private _scaledCharTop: number = 0;

  protected _charAtlas: BaseCharAtlas | undefined;

  /**
   * An object that's reused when drawing glyphs in order to reduce GC.
   */
  private _currentGlyphIdentifier: IGlyphIdentifier = {
    chars: '',
    code: 0,
    bg: 0,
    fg: 0,
    bold: false,
    dim: false,
    italic: false
  };

  constructor(
    private _container: HTMLElement,
    id: string,
    zIndex: number,
    private _alpha: boolean,
    protected _colors: IColorSet,
    private _rendererId: number,
    protected readonly _bufferService: IBufferService,
    protected readonly _optionsService: IOptionsService
  ) {
    this._canvas = document.createElement('canvas');
    this._canvas.classList.add(`xterm-${id}-layer`);
    this._canvas.style.zIndex = zIndex.toString();
    this._initCanvas();
    this._container.appendChild(this._canvas);
  }

  public dispose(): void {
    this._container.removeChild(this._canvas);
    this._charAtlas?.dispose();
  }

  private _initCanvas(): void {
    this._ctx = throwIfFalsy(this._canvas.getContext('2d', {alpha: this._alpha}));
    // Draw the background if this is an opaque layer
    if (!this._alpha) {
      this._clearAll();
    }
  }

  public onOptionsChanged(): void {}
  public onBlur(): void {}
  public onFocus(): void {}
  public onCursorMove(): void {}
  public onGridChanged(startRow: number, endRow: number): void {}
  public onSelectionChanged(start: [number, number] | undefined, end: [number, number] | undefined, columnSelectMode: boolean = false): void {}

  public setColors(colorSet: IColorSet): void {
    this._refreshCharAtlas(colorSet);
  }

  protected _setTransparency(alpha: boolean): void {
    // Do nothing when alpha doesn't change
    if (alpha === this._alpha) {
      return;
    }

    // Create new canvas and replace old one
    const oldCanvas = this._canvas;
    this._alpha = alpha;
    // Cloning preserves properties
    this._canvas = this._canvas.cloneNode() as HTMLCanvasElement;
    this._initCanvas();
    this._container.replaceChild(this._canvas, oldCanvas);

    // Regenerate char atlas and force a full redraw
    this._refreshCharAtlas(this._colors);
    this.onGridChanged(0, this._bufferService.rows - 1);
  }

  /**
   * Refreshes the char atlas, aquiring a new one if necessary.
   * @param colorSet The color set to use for the char atlas.
   */
  private _refreshCharAtlas(colorSet: IColorSet): void {
    if (this._scaledCharWidth <= 0 && this._scaledCharHeight <= 0) {
      return;
    }
    this._charAtlas = acquireCharAtlas(this._optionsService.options, this._rendererId, colorSet, this._scaledCharWidth, this._scaledCharHeight);
    this._charAtlas.warmUp();
  }

  public resize(dim: IRenderDimensions): void {
    this._scaledCellWidth = dim.scaledCellWidth;
    this._scaledCellHeight = dim.scaledCellHeight;
    this._scaledCharWidth = dim.scaledCharWidth;
    this._scaledCharHeight = dim.scaledCharHeight;
    this._scaledCharLeft = dim.scaledCharLeft;
    this._scaledCharTop = dim.scaledCharTop;
    this._canvas.width = dim.scaledCanvasWidth;
    this._canvas.height = dim.scaledCanvasHeight;
    this._canvas.style.width = `${dim.canvasWidth}px`;
    this._canvas.style.height = `${dim.canvasHeight}px`;

    // Draw the background if this is an opaque layer
    if (!this._alpha) {
      this._clearAll();
    }

    this._refreshCharAtlas(this._colors);
  }

  public abstract reset(): void;

  /**
   * Fills 1+ cells completely. This uses the existing fillStyle on the context.
   * @param x The column to start at.
   * @param y The row to start at
   * @param width The number of columns to fill.
   * @param height The number of rows to fill.
   */
  protected _fillCells(x: number, y: number, width: number, height: number): void {
    this._ctx.fillRect(
      x * this._scaledCellWidth,
      y * this._scaledCellHeight,
      width * this._scaledCellWidth,
      height * this._scaledCellHeight);
  }

  /**
   * Fills a 1px line (2px on HDPI) at the bottom of the cell. This uses the
   * existing fillStyle on the context.
   * @param x The column to fill.
   * @param y The row to fill.
   */
  protected _fillBottomLineAtCells(x: number, y: number, width: number = 1): void {
    this._ctx.fillRect(
      x * this._scaledCellWidth,
      (y + 1) * this._scaledCellHeight - window.devicePixelRatio - 1 /* Ensure it's drawn within the cell */,
      width * this._scaledCellWidth,
      window.devicePixelRatio);
  }

  /**
   * Fills a 1px line (2px on HDPI) at the left of the cell. This uses the
   * existing fillStyle on the context.
   * @param x The column to fill.
   * @param y The row to fill.
   */
  protected _fillLeftLineAtCell(x: number, y: number, width: number): void {
    this._ctx.fillRect(
      x * this._scaledCellWidth,
      y * this._scaledCellHeight,
      window.devicePixelRatio * width,
      this._scaledCellHeight);
  }

  /**
   * Strokes a 1px rectangle (2px on HDPI) around a cell. This uses the existing
   * strokeStyle on the context.
   * @param x The column to fill.
   * @param y The row to fill.
   */
  protected _strokeRectAtCell(x: number, y: number, width: number, height: number): void {
    this._ctx.lineWidth = window.devicePixelRatio;
    this._ctx.strokeRect(
      x * this._scaledCellWidth + window.devicePixelRatio / 2,
      y * this._scaledCellHeight + (window.devicePixelRatio / 2),
      width * this._scaledCellWidth - window.devicePixelRatio,
      (height * this._scaledCellHeight) - window.devicePixelRatio);
  }

  /**
   * Clears the entire canvas.
   */
  protected _clearAll(): void {
    if (this._alpha) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    } else {
      this._ctx.fillStyle = this._colors.background.css;
      this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  /**
   * Clears 1+ cells completely.
   * @param x The column to start at.
   * @param y The row to start at.
   * @param width The number of columns to clear.
   * @param height The number of rows to clear.
   */
  protected _clearCells(x: number, y: number, width: number, height: number): void {
    if (this._alpha) {
      this._ctx.clearRect(
        x * this._scaledCellWidth,
        y * this._scaledCellHeight,
        width * this._scaledCellWidth,
        height * this._scaledCellHeight);
    } else {
      this._ctx.fillStyle = this._colors.background.css;
      this._ctx.fillRect(
        x * this._scaledCellWidth,
        y * this._scaledCellHeight,
        width * this._scaledCellWidth,
        height * this._scaledCellHeight);
    }
  }

  /**
   * Draws a truecolor character at the cell. The character will be clipped to
   * ensure that it fits with the cell, including the cell to the right if it's
   * a wide character. This uses the existing fillStyle on the context.
   * @param cell The cell data for the character to draw.
   * @param x The column to draw at.
   * @param y The row to draw at.
   * @param color The color of the character.
   */
  protected _fillCharTrueColor(cell: CellData, x: number, y: number): void {
    this._ctx.font = this._getFont(false, false);
    this._ctx.textBaseline = 'middle';
    this._clipRow(y);
    // TODO: fix
    if (!this._drawBoxChar(cell, x, y)) {
      this._ctx.fillText(
        cell.getChars(),
        x * this._scaledCellWidth + this._scaledCharLeft,
        y * this._scaledCellHeight + this._scaledCharTop + this._scaledCharHeight / 2);
    }
  }

  /**
   * Draws one or more characters at a cell. If possible this will draw using
   * the character atlas to reduce draw time.
   * @param chars The character or characters.
   * @param code The character code.
   * @param width The width of the characters.
   * @param x The column to draw at.
   * @param y The row to draw at.
   * @param fg The foreground color, in the format stored within the attributes.
   * @param bg The background color, in the format stored within the attributes.
   * This is used to validate whether a cached image can be used.
   * @param bold Whether the text is bold.
   */
  protected _drawChars(cell: ICellData, x: number, y: number): void {
    const contrastColor = this._getContrastColor(cell);

    // skip cache right away if we draw in RGB
    // Note: to avoid bad runtime JoinedCellData will be skipped
    //       in the cache handler itself (atlasDidDraw == false) and
    //       fall through to uncached later down below
    if (contrastColor || cell.isFgRGB() || cell.isBgRGB()) {
      this._drawUncachedChars(cell, x, y, contrastColor);
      return;
    }

    let fg;
    let bg;
    if (cell.isInverse()) {
      fg = (cell.isBgDefault()) ? INVERTED_DEFAULT_COLOR : cell.getBgColor();
      bg = (cell.isFgDefault()) ? INVERTED_DEFAULT_COLOR : cell.getFgColor();
    } else {
      bg = (cell.isBgDefault()) ? DEFAULT_COLOR : cell.getBgColor();
      fg = (cell.isFgDefault()) ? DEFAULT_COLOR : cell.getFgColor();
    }

    const drawInBrightColor = this._optionsService.options.drawBoldTextInBrightColors && cell.isBold() && fg < 8;

    fg += drawInBrightColor ? 8 : 0;
    this._currentGlyphIdentifier.chars = cell.getChars() || WHITESPACE_CELL_CHAR;
    this._currentGlyphIdentifier.code = cell.getCode() || WHITESPACE_CELL_CODE;
    this._currentGlyphIdentifier.bg = bg;
    this._currentGlyphIdentifier.fg = fg;
    this._currentGlyphIdentifier.bold = !!cell.isBold();
    this._currentGlyphIdentifier.dim = !!cell.isDim();
    this._currentGlyphIdentifier.italic = !!cell.isItalic();
    const atlasDidDraw = this._charAtlas && this._charAtlas.draw(
      this._ctx,
      this._currentGlyphIdentifier,
      x * this._scaledCellWidth + this._scaledCharLeft,
      y * this._scaledCellHeight + this._scaledCharTop
    );

    if (!atlasDidDraw) {
      this._drawUncachedChars(cell, x, y);
    }
  }

  /**
   * Draws one or more characters at one or more cells. The character(s) will be
   * clipped to ensure that they fit with the cell(s), including the cell to the
   * right if the last character is a wide character.
   * @param chars The character.
   * @param width The width of the character.
   * @param fg The foreground color, in the format stored within the attributes.
   * @param x The column to draw at.
   * @param y The row to draw at.
   */
  private _drawUncachedChars(cell: ICellData, x: number, y: number, fgOverride?: IColor): void {
    this._ctx.save();
    this._ctx.font = this._getFont(!!cell.isBold(), !!cell.isItalic());
    this._ctx.textBaseline = 'middle';

    if (cell.isInverse()) {
      if (fgOverride) {
        this._ctx.fillStyle = fgOverride.css;
      } else if (cell.isBgDefault()) {
        this._ctx.fillStyle = color.opaque(this._colors.background).css;
      } else if (cell.isBgRGB()) {
        this._ctx.fillStyle = `rgb(${AttributeData.toColorRGB(cell.getBgColor()).join(',')})`;
      } else {
        let bg = cell.getBgColor();
        if (this._optionsService.options.drawBoldTextInBrightColors && cell.isBold() && bg < 8) {
          bg += 8;
        }
        this._ctx.fillStyle = this._colors.ansi[bg].css;
      }
    } else {
      if (fgOverride) {
        this._ctx.fillStyle = fgOverride.css;
      } else if (cell.isFgDefault()) {
        this._ctx.fillStyle = this._colors.foreground.css;
      } else if (cell.isFgRGB()) {
        this._ctx.fillStyle = `rgb(${AttributeData.toColorRGB(cell.getFgColor()).join(',')})`;
      } else {
        let fg = cell.getFgColor();
        if (this._optionsService.options.drawBoldTextInBrightColors && cell.isBold() && fg < 8) {
          fg += 8;
        }
        this._ctx.fillStyle = this._colors.ansi[fg].css;
      }
    }

    this._clipRow(y);

    // Apply alpha to dim the character
    if (cell.isDim()) {
      this._ctx.globalAlpha = DIM_OPACITY;
    }

    // Maybe manually draw box character
    if (!this._drawBoxChar(cell, x, y)) {
      // Draw the character
      this._ctx.fillText(
        cell.getChars(),
        x * this._scaledCellWidth + this._scaledCharLeft,
        y * this._scaledCellHeight + this._scaledCharTop + this._scaledCharHeight / 2);
    }
    this._ctx.restore();
  }

  private _drawBoxChar(cell: ICellData, x: number, y: number): boolean {
    const code = boxDrawingLineCodes[cell.getChars()];
    if (!code) {
      return false;
    }

    // TODO: Clean below
    this._ctx.strokeStyle = this._ctx.fillStyle;
    this._ctx.lineWidth = window.devicePixelRatio; 

    const scale = window.devicePixelRatio;
    const horizontalCenter = this._scaledCellWidth / 2.0;
    const verticalCenter = this._scaledCellHeight / 2.0;
    const xs = [
        0,
        horizontalCenter - scale,
        horizontalCenter - scale/2,
        horizontalCenter,
        horizontalCenter + scale/2,
        horizontalCenter + scale,
        this._scaledCellWidth
    ];
    const ys = [
        0,
        verticalCenter - scale,
        verticalCenter - scale/2,
        verticalCenter,
        verticalCenter + scale/2,
        verticalCenter + scale,
        this._scaledCellHeight
    ];
    const xoffset = x * this._scaledCellWidth + this._scaledCharLeft;
    const yoffset = y * this._scaledCellHeight + this._scaledCharTop;

    let lastX = -1;
    let lastY = -1;
    let i = 0;
    while (i + 4 <= code.length) {
      const x1 = code[i++].charCodeAt(0) - 'a'.charCodeAt(0);
      const y1 = code[i++].charCodeAt(0) - '1'.charCodeAt(0);
      const x2 = code[i++].charCodeAt(0) - 'a'.charCodeAt(0);
      const y2 = code[i++].charCodeAt(0) - '1'.charCodeAt(0);
      if (x1 != lastX || y1 != lastY) {
        this._ctx.beginPath();
        this._ctx.moveTo(xoffset + xs[x1], yoffset + ys[y1]);
      }

      if (i < code.length && code[i] != " ") {
        const cx1 = code[i++].charCodeAt(0) - 'a'.charCodeAt(0);
        const cy1 = code[i++].charCodeAt(0) - '1'.charCodeAt(0);
        const cx2 = code[i++].charCodeAt(0) - 'a'.charCodeAt(0);
        const cy2 = code[i++].charCodeAt(0) - '1'.charCodeAt(0);
        this._ctx.bezierCurveTo(
          xoffset + xs[cx1],
          yoffset + ys[cy1],
          xoffset + xs[cx2],
          yoffset + ys[cy2],
          xoffset + xs[x2],
          yoffset + ys[y2]);
        this._ctx.stroke();
      } else {
        this._ctx.lineTo(xoffset + xs[x2], yoffset + ys[y2]);
        this._ctx.stroke();
      }

      i++;

      lastX = x2;
      lastY = y2;
    }

    return true;
  }

  /**
   * Clips a row to ensure no pixels will be drawn outside the cells in the row.
   * @param y The row to clip.
   */
  private _clipRow(y: number): void {
    this._ctx.beginPath();
    this._ctx.rect(
      0,
      y * this._scaledCellHeight,
      this._bufferService.cols * this._scaledCellWidth,
      this._scaledCellHeight);
    this._ctx.clip();
  }

  /**
   * Gets the current font.
   * @param isBold If we should use the bold fontWeight.
   */
  protected _getFont(isBold: boolean, isItalic: boolean): string {
    const fontWeight = isBold ? this._optionsService.options.fontWeightBold : this._optionsService.options.fontWeight;
    const fontStyle = isItalic ? 'italic' : '';

    return `${fontStyle} ${fontWeight} ${this._optionsService.options.fontSize * window.devicePixelRatio}px ${this._optionsService.options.fontFamily}`;
  }

  private _getContrastColor(cell: CellData): IColor | undefined {
    if (this._optionsService.options.minimumContrastRatio === 1) {
      return undefined;
    }

    // Try get from cache first
    const adjustedColor = this._colors.contrastCache.getColor(cell.bg, cell.fg);
    if (adjustedColor !== undefined) {
      return adjustedColor || undefined;
    }

    let fgColor = cell.getFgColor();
    let fgColorMode = cell.getFgColorMode();
    let bgColor = cell.getBgColor();
    let bgColorMode = cell.getBgColorMode();
    const isInverse = !!cell.isInverse();
    const isBold = !!cell.isInverse();
    if (isInverse) {
      const temp = fgColor;
      fgColor = bgColor;
      bgColor = temp;
      const temp2 = fgColorMode;
      fgColorMode = bgColorMode;
      bgColorMode = temp2;
    }

    const bgRgba = this._resolveBackgroundRgba(bgColorMode, bgColor, isInverse);
    const fgRgba = this._resolveForegroundRgba(fgColorMode, fgColor, isInverse, isBold);
    const result = rgba.ensureContrastRatio(bgRgba, fgRgba, this._optionsService.options.minimumContrastRatio);

    if (!result) {
      this._colors.contrastCache.setColor(cell.bg, cell.fg, null);
      return undefined;
    }

    const color: IColor = {
      css: channels.toCss(
        (result >> 24) & 0xFF,
        (result >> 16) & 0xFF,
        (result >> 8) & 0xFF
      ),
      rgba: result
    };
    this._colors.contrastCache.setColor(cell.bg, cell.fg, color);

    return color;
  }

  private _resolveBackgroundRgba(bgColorMode: number, bgColor: number, inverse: boolean): number {
    switch (bgColorMode) {
      case Attributes.CM_P16:
      case Attributes.CM_P256:
        return this._colors.ansi[bgColor].rgba;
      case Attributes.CM_RGB:
        return bgColor << 8;
      case Attributes.CM_DEFAULT:
      default:
        if (inverse) {
          return this._colors.foreground.rgba;
        }
        return this._colors.background.rgba;
    }
  }

  private _resolveForegroundRgba(fgColorMode: number, fgColor: number, inverse: boolean, bold: boolean): number {
    switch (fgColorMode) {
      case Attributes.CM_P16:
      case Attributes.CM_P256:
        if (this._optionsService.options.drawBoldTextInBrightColors && bold && fgColor < 8) {
          fgColor += 8;
        }
        return this._colors.ansi[fgColor].rgba;
      case Attributes.CM_RGB:
        return fgColor << 8;
      case Attributes.CM_DEFAULT:
      default:
        if (inverse) {
          return this._colors.background.rgba;
        }
        return this._colors.foreground.rgba;
    }
  }
}

const boxDrawingLineCodes: { [index: string]: string } = {
  "─": "a4g4",
  "━": "a3g3 a5g5",
  "│": "d1d7",
  "┃": "c1c7 e1e7",
  "┌": "g4d4 d4d7",
  "┍": "g3d3 d3d7 g5d5",
  "┎": "g4c4 c4c7 e4e7",
  "┏": "g3c3 c3c7 g5e5 e5e7",
  "┐": "a4d4 d4d7",
  "┑": "a3d3 d3d7 a5d5",
  "┒": "a4e4 e4e7 c4c7",
  "┓": "a3e3 e3e7 a5c5 c5c7",
  "└": "d1d4 d4g4",
  "┕": "d1d5 d5g5 d3g3",
  "┖": "c1c4 c4g4 e1e4",
  "┗": "c1c5 c5g5 e1e3 e3g3",
  "┘": "a4d4 d4d1",
  "┙": "a5d5 d5d1 a3d3",
  "┚": "a4e4 e4e1 c4c1",
  "┛": "a5e5 e5e1 a3c3 c3c1",
  "├": "d1d7 d4g4",
  "┝": "d1d7 d3g3 d5g5",
  "┞": "c1c4 e1e4 e4g4 d4d7",
  "┟": "d1d4 d4g4 c4c7 e4e7",
  "┠": "c1c7 e1e7 e4g4",
  "┡": "c1c4 c4g4 e1e3 e3g3 d4d7",
  "┢": "d1d4 c7c3 c3g3 e7e5 e5g5",
  "┣": "c1c7 e1e3 e3g3 g5e5 e5e7",
  "┤": "d1d7 a4d4",
  "┥": "d1d7 a3d3 a5d5",
  "┦": "c1c4 e1e4 a4d4 d4d7",
  "┧": "d1d4 d4a4 c4c7 e4e7",
  "┨": "a4c4 c1c7 e1e7",
  "┩": "c1c3 c3a3 e1e5 e5a5 d4d7",
  "┪": "a3d3 d3d7 a5c5 c5c7 d1d4",
  "┫": "a3c3 c3c1 a5c5 c5c7 e1e7",
  "┬": "a4g4 d4d7",
  "┭": "a3d3 a5d5 d7d4 d4g4",
  "┮": "a4d4 d4d7 d3g3 d5g5",
  "┯": "a3g3 a5g5 d5d7",
  "┰": "a4g4 c4c7 e4e7",
  "┱": "a3e3 e3e7 a5c5 c5c7 d4g4",
  "┲": "a4d4 c7c3 c3g3 e7e5 e5g5",
  "┳": "a3g3 a5c5 c5c7 e7e5 e5g5",
  "┴": "a4g4 d1d4",
  "┵": "d1d4 d4g4 a3d3 a5d5",
  "┶": "a4d4 d4d1 d3g3 d5g5",
  "┷": "a3g3 a5g5 d1d4",
  "┸": "a4g4 c1c4 e1e4",
  "┹": "a3c3 c3c1 a5e5 e5e1 d4g4",
  "┺": "a4d4 c1c5 c5g5 d1d3 d3g3",
  "┻": "a5g5 a3c3 c3c1 e1e3 e3g3",
  "┼": "a4g4 d1d7",
  "┽": "d1d7 d4g4 a3d3 a5d5",
  "┾": "d1d7 a4d4 d3g3 d5g5",
  "┿": "d1d7 a3g3 a5g5",
  "╀": "a4g4 d4d7 c1c4 e1e4",
  "╁": "a4g4 d1d4 c4c7 e4e7",
  "╂": "a4g4 c1c7 e1e7",
  "╃": "a3c3 c3c1 a5e5 e5e1 d7d4 d4g4",
  "╄": "a4d4 d4d7 c1c5 c5g5 e1e3 e3g3",
  "╅": "d1d4 d4g4 a3e3 e3e7 a5c5 c5c7",
  "╆": "a4d4 d4d1 c7c3 c3g3 e7e5 e5g5",
  "╇": "a5g5 a3c3 c3c1 e1e3 e3g3 d4d7",
  "╈": "d1d4 a3g3 a5c5 c5c7 e7e5 e5g5",
  "╉": "a3c3 c3c1 a5c5 c5c7 e1e7 d4g4",
  "╊": "a4c4 c1c7 e1e3 e3g3 e7e5 e5g5",
  "╋": "a3g3 a5g5 c1c7 e1e7",
  "═": "a2g2 a6g6",
  "║": "b1b7 f1f7",
  "╒": "g2d2 d2d7 g6d6",
  "╓": "g4b4 b4b7 f4f7",
  "╔": "g2b2 b2b7 g6f6 f6f7",
  "╕": "a2d2 d2d7 a6d6",
  "╖": "a4f4 f4f7 b4b7",
  "╗": "a2f2 f2f7 a6b6 b6b7",
  "╘": "d1d6 d6g6 d2g2",
  "╙": "b1b4 b4g4 f1f4",
  "╚": "b1b6 b6g6 f1f2 f2g2",
  "╛": "a2d2 a6d6 d6d1",
  "╜": "a4f4 f4f1 b4b1",
  "╝": "a2b2 b2b1 a6f6 f6f1",
  "╞": "d1d7 d2g2 d6g6",
  "╟": "b1b7 f1f7 f4g4",
  "╠": "b1b7 f1f2 f2g2 f7f6 f6g6",
  "╡": "d1d7 a2d2 a6d6",
  "╢": "a4b4 b1b7 f1f7",
  "╣": "a2b2 b2b1 a6b6 b6b7 f1f7",
  "╤": "a2g2 a6g6 d6d7",
  "╥": "a4g4 b4b7 f4f7",
  "╦": "a2g2 a6b6 b6b7 f7f6 f6g6",
  "╧": "a6g6 a2g2 d1d2",
  "╨": "a4g4 b1b4 f1f4",
  "╩": "a2b2 b2b1 f1f2 f2g2 a6g6",
  "╪": "a2g2 a6g6 d1d7",
  "╫": "b1b7 f1f7 a4g4",
  "╬": "a2b2 b2b1 f1f2 f2g2 g6f6 f6f7 b7b6 b6a6",
  "╭": "g4d7d4d4",
  "╮": "a4d7d4d4",
  "╯": "a4d1d4d4",
  "╰": "d1g4d4d4",
  "╱": "a7g1",
  "╲": "a1g7",
  "╳": "a7g1 a1g7",
  "╴": "a4d4",
  "╵": "d1d4",
  "╶": "d4g4",
  "╷": "d4d7",
  "╸": "a3d3 a5d5",
  "╹": "c1c4 e1e4",
  "╺": "d3g3 d5g5",
  "╻": "c4c7 e4e7",
  "╼": "a4d4 d3g3 d5g5",
  "╽": "d1d4 c4c7 e4e7",
  "╾": "a3d3 a5d5 d4g4",
  "╿": "c1c4 e1e4 d4d7"
};