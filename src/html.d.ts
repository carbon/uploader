interface Array<T> {
  remove(item: any): void;
}

interface String {
  startsWith(text: string) : boolean;
  includes(text: string) : boolean;
}


interface HTMLElement {
  matches(selectors: string):boolean;
}