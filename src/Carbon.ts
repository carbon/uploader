module Carbon {
   export interface Reactive {
    on(name: string, callback: Function);

    trigger(any);
  }
  
  export interface Template {
    constructor(name: any);

    render(data?): HTMLElement;
  }
}