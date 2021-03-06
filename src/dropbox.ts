module Carbon {
  export class DropboxChooser implements Picker {   
    key: string;

    loaded = false;
    loading = false;
    reactive = new Carbon.Reactive();
    
    accept: string[];
    
    constructor(key: string, options) {
      this.key = key;
      
      if (options && options.accept) {
        this.accept = options.accept;  
      }
    }

    open() {
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
    
    _open() {
      this.loaded = true;

      let options = <any> {
        linkType    : 'direct',
        multiselect : true,
        success     : this.onSelection.bind(this),
        cancel      : this.onCancel.bind(this)
      };
      
      if (this.accept) {
        // extensions: ['.pdf', '.doc', '.docx']
        options.extensions = this.accept.map(f => '.' + f);
      }
      
      Dropbox.choose(options);
    }

    setAccept(formats: string[]) {
      this.accept = formats;
    }
    
    onCancel() { }

    onSelection(files) {
      let uploads = files.map(file => {
        let upload = new UrlUpload(file.link);
        
        upload.size = file.size;
        upload.name = file.name;
        upload.source = 'dropbox';
        upload.thumbnailUrl = file.thumbnailLink;
        
        return upload;
      });
      
      this.reactive.trigger(uploads);
    }

    loadScript(): PromiseLike<boolean> {
      if (this.loaded) return Promise.resolve(true);
      
      console.log('loading dropbox');
            
      this.loading = true;
       
      return new Promise((resolve, reject) => {
        let el = document.createElement('script');
        
        el.id = "dropboxjs"
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