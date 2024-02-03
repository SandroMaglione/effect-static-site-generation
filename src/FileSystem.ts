import * as Fs from "@effect/platform-node/FileSystem";
import * as PlatformError from "@effect/platform/Error";
import {
  Console,
  Context,
  Effect,
  Layer,
  Option,
  ReadonlyArray,
  pipe,
} from "effect";
import * as _HtmlMinifier from "html-minifier"; // TODO: Change with `@minify-html/node` (https://github.com/wilsonzlin/minify-html/issues/172)
import type { FrontmatterSchema } from "./schema";

interface MarkdownFile {
  markdown: string;
  fileName: string;
  title: string;
  modifiedAt: Date;
}

export interface FileSystem {
  readonly _: unique symbol;
}
export interface FileSystemImpl {
  buildMarkdownFiles: Effect.Effect<
    never,
    PlatformError.PlatformError,
    MarkdownFile[]
  >;

  writeHtml: (params: {
    fileName: string;
    html: string;
    frontmatterSchema: FrontmatterSchema;
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
  Effect.map(Fs.FileSystem, (fs) =>
    FileSystem.of({
      buildMarkdownFiles: Effect.gen(function* (_) {
        const fileNames = yield* _(fs.readDirectory(`./pages`)); // TODO: Config for path "pages"
        yield* _(Console.log("Files in 'pages':", fileNames));

        const files = yield* _(
          Effect.all(
            pipe(
              fileNames,
              ReadonlyArray.map((fileNameWithExtension: string) =>
                Effect.gen(function* (_) {
                  const path = `./pages/${fileNameWithExtension}`;
                  const stat = yield* _(fs.stat(path));
                  const modifiedAt = pipe(
                    stat.mtime,
                    Option.getOrElse(() => new Date())
                  );
                  const markdown = yield* _(fs.readFileString(path));

                  const fileNameWithoutExtension =
                    fileNameWithExtension.replace(/\.[^/.]+$/, "");
                  const fileName = fileNameWithoutExtension.toLowerCase();
                  const title = fileNameWithoutExtension.replace(/-/g, " ");
                  return { fileName, markdown, title, modifiedAt };
                })
              )
            ),
            { concurrency: "unbounded" } // TODO
          )
        );

        const existsBuild = yield* _(fs.exists("./build"));
        if (existsBuild) {
          yield* _(fs.remove("./build", { recursive: true }));
        }

        yield* _(fs.makeDirectory("./build"));

        return files;
      }),

      writeHtml: ({ fileName, html, frontmatterSchema }) =>
        Effect.gen(function* (_) {
          yield* _(Console.log("Writing html:", html));
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
          yield* _(fs.writeFileString(`./build/${fileName}.html`, minifyHtml));
        }),

      writeCss: ({ source }) =>
        Effect.gen(function* (_) {
          yield* _(fs.writeFile("./build/style.css", source));
        }),

      writeStaticFiles: Effect.gen(function* (_) {
        const staticFiles = yield* _(fs.readDirectory("./static"));
        yield* _(
          Effect.all(
            staticFiles.map((file) =>
              fs.copyFile(`./static/${file}`, `./build/${file}`)
            ),
            {
              concurrency: "unbounded", // TODO
            }
          )
        );
      }),
    })
  )
).pipe(Layer.provide(Fs.layer));
