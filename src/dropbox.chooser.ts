module Carbon {
  class ExternalChooser {
    loaded = false;
    loading = false;
    reactive = new Carbon.Reactive();

    // to defined by subclasses
    _open() {};
    
    loadScript(): Promise<any> {
      return Promise.resolve(true);
    };

    open() {
      console.log('open');

      if (!this.loaded) {
        this.loadScript().then(this._open.bind(this));
      } 
      else {
        this._open();
      }
    }

    subscribe(callback: Function) {
      return this.reactive.subscribe(callback);
    }
  }

  export class DropboxChooser extends ExternalChooser {
    key: string;

    constructor(key: string) {
      super();
      this.key = key || '3ta2xeuzehs6pob'; // Carbonmade Picker
    }

    _open() {
      this.loaded = true;

      Dropbox.choose({
        linkType    : 'direct',
        multiselect : true,
        success     : this.onSelection.bind(this),
        cancel      : this.onCancel.bind(this)
      });
    }

    onCancel() { }

    onSelection (files) {
      let uploads = files.map(file => new Carbon.UrlUpload(file.link));
      
      this.reactive.trigger(uploads);
    }

    loadScript():  Promise<any> {
      if (this.loaded) return Promise.resolve(true);
      
      console.log('loading dropbox');
            
       this.loading = true;
       
      return new Promise((resolve, reject) => {
        let el = document.createElement('script');
        
        el.id = "dropboxjs"
        el.type = "text/javascript";
        el.async = true;
        el.setAttribute('data-app-key', this.key);

        el.addEventListener('load', e => {
          this.loaded = true;
          this.loading = false;

          resolve();
        }, false);

        el.src = 'https://www.dropbox.com/static/api/2/dropins.js';

        let headEl = document.getElementsByTagName('head')[0];
        
        headEl.appendChild(el);
      });
    }
  }
}