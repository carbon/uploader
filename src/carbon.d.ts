declare module Carbon {
   export class Reactive {
    on(name: string, callback: Function);

    trigger(any);
  }
  
  export class Template {
    static get(name: string): Template;
    
    constructor(name: any);

    render(data?): HTMLElement;
  }
}