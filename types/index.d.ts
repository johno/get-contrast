type Option = {
    ignoreAlpha: boolean
}

export function ratio(colorOne: string, colorTwo: string, options?: Option): string
export function score(colorOne: string, colorTwo: string, options?: Option): string
export function isAccessible(colorOne: string, colorTwo: string, options?: Option): boolean
export function isNotTransparent(color: string, options?: Option): boolean
