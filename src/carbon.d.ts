declare module Carbon {
   export class Reactive {
    on(name: string, callback: Function);

    trigger(any);
    
    subscribe(callback: Function);
  }
  
  export class Template {
    static get(name: string): Template;
    
    constructor(name: any);

    render(data?): HTMLElement;
  }
}