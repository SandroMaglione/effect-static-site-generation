import * as Fs from "@effect/platform-node/FileSystem";
import * as Path from "@effect/platform-node/Path";
import * as PlatformError from "@effect/platform/Error";
import { Context, Effect, Layer, Option, ReadonlyArray, pipe } from "effect";
import * as _HtmlMinifier from "html-minifier"; // TODO: Change with `@minify-html/node` (https://github.com/wilsonzlin/minify-html/issues/172)
import * as Frontmatter from "./Frontmatter.js";
import * as file from "./file.js";
import type { FrontmatterSchema } from "./schema.js";

interface MarkdownFile {
  /**
   * Original markdown file name with `.md` extension
   */
  origin: string;
  /**
   * Original markdown file name with no extension and all lowercase (link)
   */
  fileName: string;
  /**
   * Markdown body without frontmatter
   */
  body: string;
  title: string;
  modifiedAt: Date;
  frontmatterSchema: FrontmatterSchema;
}

export interface FileSystem {
  readonly _: unique symbol;
}

export interface FileSystemImpl {
  buildMarkdownFiles: Effect.Effect<
    never,
    Frontmatter.FrontmatterError | PlatformError.PlatformError,
    MarkdownFile[]
  >;

  readConfig: Effect.Effect<never, PlatformError.PlatformError, string>;

  writeHtml: (params: {
    fileName: string;
    html: string;
    frontmatterSchema: FrontmatterSchema;
  }) => Effect.Effect<never, PlatformError.PlatformError, void>;

  writeIndex: (params: {
    html: string;
  }) => Effect.Effect<never, PlatformError.PlatformError, void>;

  writeCss: (params: {
    source: globalThis.Uint8Array;
  }) => Effect.Effect<never, PlatformError.PlatformError, void>;

  writeStaticFiles: Effect.Effect<never, PlatformError.PlatformError, void>;
}

export const FileSystem = Context.Tag<FileSystem, FileSystemImpl>(
  "@app/FileSystem"
);

export const FileSystemLive = Layer.effect(
  FileSystem,
  Effect.map(
    Effect.all([Fs.FileSystem, Path.Path, Frontmatter.Frontmatter]),
    ([fs, path, { extractFrontmatter }]) =>
      FileSystem.of({
        readConfig: Effect.gen(function* (_) {
          return yield* _(fs.readFileString(path.join(".", "config.json")));
        }),

        buildMarkdownFiles: Effect.gen(function* (_) {
          const fileNames = yield* _(
            fs.readDirectory(path.join(".", "/pages"))
          ); // TODO: Config for path "pages"

          yield* _(Effect.logInfo(`${fileNames.length} pages`));
          for (let f = 0; f < fileNames.length; f++) {
            yield* _(Effect.logInfo(`   ${fileNames[f]}`));
          }

          const files = yield* _(
            Effect.all(
              pipe(
                fileNames,
                ReadonlyArray.map((fileNameWithExtension: string) =>
                  Effect.gen(function* (_) {
                    const pathJoin = path.join(
                      ".",
                      "pages",
                      fileNameWithExtension
                    );
                    const stat = yield* _(fs.stat(pathJoin));
                    const modifiedAt = pipe(
                      stat.mtime,
                      Option.getOrElse(() => new Date())
                    );
                    const markdown = yield* _(fs.readFileString(pathJoin));

                    const fileName = file.fileName(fileNameWithExtension);
                    const title = file.title(fileNameWithExtension);
                    const { body, frontmatterSchema } = yield* _(
                      extractFrontmatter(markdown)
                    );
                    return {
                      fileName,
                      body,
                      title,
                      modifiedAt,
                      origin: fileNameWithExtension,
                      frontmatterSchema,
                    } satisfies MarkdownFile;
                  })
                )
              ),
              { concurrency: "unbounded" } // TODO
            )
          );

          const existsBuild = yield* _(fs.exists(path.join(".", "build")));
          if (existsBuild) {
            yield* _(fs.remove(path.join(".", "build"), { recursive: true }));
          }

          yield* _(fs.makeDirectory(path.join(".", "build")));

          return files;
        }),

        writeHtml: ({ fileName, html, frontmatterSchema }) =>
          Effect.gen(function* (_) {
            const minifyHtml = _HtmlMinifier.minify(html, {
              includeAutoGeneratedTags: true,
              removeAttributeQuotes: true,
              removeComments: true,
              removeRedundantAttributes: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              sortClassName: true,
              useShortDoctype: true,
              collapseWhitespace: true,
            });
            yield* _(
              fs.writeFileString(
                path.join(".", "build", `${fileName}.html`),
                minifyHtml
              )
            );
          }),

        writeIndex: ({ html }) =>
          Effect.gen(function* (_) {
            const minifyHtml = _HtmlMinifier.minify(html, {
              includeAutoGeneratedTags: true,
              removeAttributeQuotes: true,
              removeComments: true,
              removeRedundantAttributes: true,
              removeScriptTypeAttributes: true,
              removeStyleLinkTypeAttributes: true,
              sortClassName: true,
              useShortDoctype: true,
              collapseWhitespace: true,
            });
            yield* _(
              fs.writeFileString(
                path.join(".", "build", "index.html"),
                minifyHtml
              )
            );
          }),

        writeCss: ({ source }) =>
          Effect.gen(function* (_) {
            yield* _(
              fs.writeFile(path.join(".", "build", "style.css"), source)
            );
          }),

        writeStaticFiles: Effect.gen(function* (_) {
          const staticFiles = yield* _(
            fs.readDirectory(path.join(".", "static"))
          );

          yield* _(Effect.logInfo(`${staticFiles.length} static files`));
          for (let f = 0; f < staticFiles.length; f++) {
            yield* _(Effect.logInfo(`   ${staticFiles[f]}`));
          }

          yield* _(
            Effect.all(
              staticFiles.map((file) =>
                fs.copyFile(
                  path.join(".", "static", file),
                  path.join(".", "build", file)
                )
              ),
              {
                concurrency: "unbounded", // TODO
              }
            )
          );
        }),
      })
  )
).pipe(
  Layer.provide(
    Layer.mergeAll(Fs.layer, Path.layer, Frontmatter.FrontmatterLive)
  )
);
