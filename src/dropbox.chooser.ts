module Carbon {
  class ExternalChooser {
    loaded = false;
    loading = false;
    reactive = new Carbon.Reactive();

    // to defined by subclasses
    _open() {};
    loadScript(callback: Function) {};

    open() {
      console.log('open');

      if (!this.loaded) {
        this.loadScript(this._open.bind(this));
      } else {
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

    onCancel() {}

    onSelection (files) {
      var uploads = files.map(file => {
        return new Carbon.UrlUpload(file.link);
      });
      this.reactive.trigger(uploads);
    }

    loadScript(callback: Function) {
      console.log('load script');

      if (this.loading) return;

      this.loading = true;

      var el = document.createElement('script');
      el.id = "dropboxjs"
      el.type = "text/javascript";
      el.async = true;
      el.setAttribute('data-app-key', this.key);

      el.addEventListener('load', e => {
        console.log('loaded');

        this.loaded = true;
        this.loading = false;

        callback();
      }, false);

      el.src = 'https://www.dropbox.com/static/api/2/dropins.js';

      var headEl = document.getElementsByTagName('head')[0];
      headEl.appendChild(el);
    }
  }
}
