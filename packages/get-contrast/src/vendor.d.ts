// Declarations for the untyped legacy runtime dependencies. These go away with
// the dependencies themselves (see the zero-dependency issue).
declare module "rgb" {
  // Returns a normalized "rgb(r,g,b)" / "rgba(r,g,b,a)" string, or null when
  // the input cannot be parsed.
  function rgb(color: string): string | null;
  export default rgb;
}

declare module "wcag-contrast" {
  export function rgb(a: readonly string[], b: readonly string[]): number;
  export function score(ratio: number): string;
}

declare module "is-blank" {
  function isBlank(value: unknown): boolean;
  export default isBlank;
}

declare module "is-named-css-color" {
  function isNamedCssColor(value: string): boolean;
  export default isNamedCssColor;
}

declare module "css-color-names" {
  const names: Readonly<Record<string, string>>;
  export default names;
}
