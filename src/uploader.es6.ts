
  export class Progress {
    constructor(public loaded: number, public total: number) {
      this.loaded = loaded;
      this.total = total;
    }

    get value() {
      return this.total !== 0 ? (this.loaded / this.total) : 0;
    }

    toString() {
      return Math.round(this.value * 100) + "%";
    }
  }

  export class UploadBatch {
    queued: Array<Upload> = [];
    rejected: Array<Upload> = [];

    constructor() {

    }
  }

  interface UploaderOptions {
    url: string;
    method?: string;
    debug?: boolean;
    uploadLimit?: number;
    accept?: string[];
    inputs?: Picker[];
  }
  
  export class UploadManager {
    status = UploadStatus.Pending;
    subscriptions = [];

    options: UploaderOptions;

    uploads: Array<Upload>;
    queue: Array<Upload>;

    completedCount = 0;
    canceledCount = 0;

    debug = false;

    uploadLimit: number;

    accept: string[];

    progress: Progress;

    maxSize = 5000000000; // 5GB

    reactive = new Reactive();

    constructor(options: UploaderOptions) {
      this.options = options || { url: '' };
      this.reset();

      this.debug = this.options.debug || false;

      // options.accept = [ 'gif', 'jpeg', ... ]

      this.uploadLimit = options.uploadLimit || 1000;
      this.accept = options.accept;

      if (this.uploadLimit < 0) {
        this.uploadLimit = 0;
      }

      if (this.options.inputs) {
        for (var input of this.options.inputs) {
          this.addSource(input);
        }
      }
    }

    on(type: string, callback: Function) {     
      return this.reactive.on(type, callback); 
    }

    addSource(source: Picker) {
      // sources may be file inputs or drops

      // Configure accept
      if (this.accept && source.setAccept) {
        source.setAccept(this.accept);
      }

      let subscription = source.subscribe(this.addFiles.bind(this));

      // Subscribe to the sources files
      this.subscriptions.push(subscription);
    }

    accepts(format: string) {
      if (!this.options.accept) return true;

      return this.options.accept.filter(f => f == format).length > 0;
    }

    queueFile(file) {
      let upload = file.promise ? file : new Upload(file, this.options);

      // Format check
      if (!this.accepts(upload.format)) {
        upload.rejected = true;
        upload.rejectionReason = 'Unsupported';
      }

      if (upload.size > this.maxSize) {
        upload.rejected = true;
        upload.rejectionReason = 'Too large';
      }

      // Max size check
      else if (this.uploads.length >= this.uploadLimit) {
        upload.rejected = true;
        upload.rejectionReason = 'Over limit';
      }

      // OK
      else {
        this.queue.push(upload);    // Add to queue
        this.uploads.push(upload);  // Add to uploads list
      }
      
      upload.on('cancel', () => {
        console.log('upload canceled', this);
        
        this.removeUpload(upload);
      });

      return upload;
    }

    addFiles(files: FileList) {
      let batch = new UploadBatch();

      if (!files || files.length == 0) return batch;

      for (var i = 0, len = files.length; i < len; i++) {
        let upload = this.queueFile(files[i]);

        if (upload.rejected) {
          batch.rejected.push(upload);
        }
        else {
          batch.queued.push(upload);
        }
      }

      this.reactive.trigger({
        type     : 'add',
        queued   : batch.queued,
        rejected : batch.rejected
      });

      return batch;
    }

    removeUpload(upload: Upload) {
      this.queue.remove(upload);
      this.uploads.remove(upload);

      this.reactive.trigger({
        type: 'remove',
        upload: upload
      });
    }

    reset() {
      this.queue = [];
      this.uploads = [];

      this.progress = new Progress(0, 0);

      this.completedCount = 0;
      this.canceledCount = 0;

      if (this.options.inputs) {
        for (var picker of this.options.inputs) {  
          if (picker.clear) {
            picker.clear();
          }
        }
      }
    }

    setUploadLimit(value: number) {
      this.uploadLimit = value;

      if (this.debug) {
        console.log('Upload limit set: ' + value);
      }
    }

    start() {
      this.status = UploadStatus.Uploading; // processing

      this.reactive.trigger({
        type: 'start',
        instance: this
      });

      this.uploadNext();
    }

    uploadNext() {
      if (this.queue.length == 0) {
        this.status = UploadStatus.Completed; // done

        this.reactive.trigger({
          type     : 'complete',
          instance : this,
          uploads  : this.uploads
        });
        
        return; // We've completed the queue
      }

      let upload = this.queue.shift();

      upload.on('progress', e => {
        var loaded = 0;
        var total = 0;

        for (var upload of this.uploads) {
          loaded += upload.progress.loaded;
          total  += upload.size;
        }

        this.progress.loaded = loaded;
        this.progress.total = total;
        
        this.notify();
      });

      this.reactive.trigger({ 
        type   : 'upload:start', 
        upload : upload
      });

      upload.start().then(
         /*success*/ () => {
           
          this.completedCount++;

          this.reactive.trigger({ 
            type   : 'upload:complete', 
            upload : upload
          });

          this.notify();

          this.uploadNext();
        },
        /*error*/ () => {
          this.canceledCount++;
          
          this.reactive.trigger({ 
            type   : 'upload:error',
            upload : upload
          });

          // Upload canceled. Start the next one immediatly
          this.notify();

          this.uploadNext();
        }
      );
    }
    
    notify() {
      this.reactive.trigger({ 
        type   : 'progress',
        loaded : this.progress.loaded,
        total  : this.progress.total,
        value  : this.progress.value 
      });
    }

    cancel() {
      // Cancel any uploads in progress
      this.uploads.forEach(u => { u.cancel(); });

      this.status = UploadStatus.Canceled; // canceled

      this.reactive.trigger({ type: 'cancel' });
    }

    dispose() {
      this.cancel();
    }
  }

  enum UploadStatus {
    Pending   = 1,
    Uploading = 2,
    Completed = 3,
    Canceled  = 4,
    Error     = 5
  }

  interface UploadOptions {
    url            : string;
    authorization? : string;
    method?        : string;
    chuckSize?     : number;
  }

  export class Upload {
    name: string;
    size: number;
    type: string;
    file: any;
    status = UploadStatus.Pending;
    baseUri: string;
    url: string;
    authorization: string | { token: string };
    retryCount: number = 0;
    method: string;
    debug = false;
    chunkSize = 1024 * 1024 * 32; // 32MiB chunks
    progress: Progress;

    offset: number;
    chunkNumber: number;
    chunkCount: number;

    rejected = false;
    rejectionReason: string;

    id: string;
    result: any;
    xhr: XMLHttpRequest;

    reactive = new Reactive();
    
    element: HTMLElement;

    defer = new Deferred<any>();
    promise: Promise<any>;
    xId: string;
    
    constructor(file, options: UploadOptions) {
      if (!file) throw new Error('file is empty');

      this.file = file;

      this.name = this.file.name;
      this.size = this.file.size;
      this.type = this.file.type; /* Mime type */

      // note: progress is already implemented by deferred
      this.progress = new Progress(0, this.size);

      if (options.chuckSize) {
        this.chunkSize = options.chuckSize;
      }

      this.method = options.method || 'POST';
      this.url = options.url;
      this.baseUri = this.url;
      
      this.authorization = options.authorization;
      
      this.promise = this.defer.promise;
    }

    on(name: string, callback) {
      return this.reactive.on(name, callback);
    }

    start(): Promise<UploadResult> {
      if (this.status >= 2) { 
        return Promise.reject('[Upload] already started');
      }

      this.offset = 0;
      this.chunkNumber = 1;
      this.chunkCount = Math.ceil(this.size / this.chunkSize);
        
      this.next();

      this.status = UploadStatus.Uploading;

      this.reactive.trigger({ type: 'start' });
  
      return this.defer.promise;
    }

    private next() {
      if (this.offset + 1 >= this.size) return;

      if (this.chunkCount > 1) {
        console.log(`'${this.name}' uploading ${this.chunkNumber} of ${this.chunkCount} chunks.`);
      }

      let start = this.offset;
      let end = this.offset + this.chunkSize;

      let data = this.file.slice(start, end);
     
      let chunk = new UploadChunk(this, data);
      
      chunk.onprogress = this.onProgress.bind(this);

      chunk.send(this).then(
        /*success*/ this.onChunkUploaded.bind(this),
        /*error*/   this.onChunkFailed.bind(this)
      );
    }

    private onChunkFailed(chunk: UploadChunk) {
      if (this.debug) {
        console.log('Chunk failed, auto retrying in 1s. ' + this.retryCount + ' of 3.');
      }

      // Retry
      if (this.retryCount < 3) {
        this.retryCount++;

        // TODO: Use expodential backoff
        setTimeout(this.next.bind(this), 1000);
      }
      else {
        this.onError(chunk);
      }
    }

    private onChunkUploaded(chunk: UploadChunk) {
      this.chunkNumber++;
      this.offset += chunk.size;

      this.result = chunk.result;
      this.id = this.result.id;

      this.retryCount = 0;

      if (this.offset == this.size) {        
        // We're done
        
        this.reactive.trigger({ type: 'complete' });
        
        this.defer.resolve(this.result);
      }
      else {
        this.xId = this.result.id;

        this.next();
      }
    }

    // Overall progress
    private onProgress(e: Progress) {
      this.progress.loaded = e.loaded + this.offset;
 
      this.reactive.trigger({
        type: 'progress',
        loaded: this.progress.loaded,
        total: this.progress.total,
        value: this.progress.value        
      });
    }

    private onError(e) {
      console.log('upload error', e);

      this.status = UploadStatus.Error;

      this.reactive.trigger({ type: 'error' });

      // TODO: Abort
      this.defer.reject();
    }

    cancel() {
      if (this.status == UploadStatus.Canceled) return;

      if(this.xhr && this.status != 4) {
        this.xhr.abort();
      }

      this.status = UploadStatus.Canceled;

      this.reactive.trigger({ type : 'cancel' });

      this.defer.reject();
    }

    onChange() {
      if (this.xhr.readyState !== 4) { }
    }

    get format() {
      return FileUtil.getFormatFromName(this.name).toLowerCase();
    }

    getFormattedSize() {
      return FileUtil.formatBytes(this.size);
    }
  }

  class UploadChunk {
    status = UploadStatus.Pending;
    file: any;
    data: any;
    size: number;
    offset: number;
    number: number;
    progress: Progress;
    onprogress: Function;
    result: any;
    error: any;
    
    defer = new Deferred<UploadChunk>();
    
    constructor(file, data) {
      if (data.size == 0) throw new Error('[Upload] data.size has no data')
      
      this.file = file;
      this.data = data;
      this.size = data.size;
      this.offset = file.offset;
      this.number = file.chunkNumber;

      this.progress = new Progress(0, this.data.size);
    }

    send(options: Upload) : Promise<UploadChunk> {
      // TODO: use fetch if supported natively

      let xhr = new XMLHttpRequest();

      xhr.addEventListener('load'  , this.onLoad.bind(this),  false);
      xhr.addEventListener('error' , this.onError.bind(this), false);
      xhr.addEventListener('abort' , this.onAbort.bind(this), false);

      xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);

      xhr.open(options.method, options.url, true);

      let contentType = this.file.type
        ? this.file.type.replace('//', '/')
        : mimes[this.file.name.substring(this.file.name.lastIndexOf('.') + 1)];

      if (contentType) {
        xhr.setRequestHeader('Content-Type', contentType);
      }

      if (options.xId) {
        xhr.setRequestHeader('X-Upload-Id', options.xId);
      }

      if (options.authorization) {
          if (typeof options.authorization == 'string') {
            xhr.setRequestHeader('Authorization', options.authorization);
          } 
          else {
            xhr.setRequestHeader('Authorization', 'Bearer ' + options.authorization.token);
          }
      }

      // File-Name (encoded to support unicode 完稿.jpg)
      xhr.setRequestHeader('X-File-Name', encodeURI(this.file.name));     

      let range = { 
        start : this.offset,
        end   : Math.min(this.offset + this.file.chunkSize, this.file.size) - 1,
        total : this.file.size
      };

      // bytes 43-1999999/2000000

      xhr.setRequestHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      
      xhr.send(/*blob*/ this.data); // Chrome7, IE10, FF3.6, Opera 12

      this.status = UploadStatus.Uploading;
      
      return this.defer.promise;
    }

    private onProgress(e: ProgressEvent) {
      if (!e.lengthComputable) return;

      this.progress.loaded = e.loaded;

      if (this.onprogress) this.onprogress(this.progress);
    }

    private onLoad(e) {
      console.log('uploaded chuck', e);

      let xhr: XMLHttpRequest = e.target;

      // too large
      if (xhr.status == 413) {
        this.status = UploadStatus.Error;
        this.error = { code: 413, message: 'Entity too large' };
        
        this.defer.reject(this);
      }

      if (xhr.readyState !== 4) {
        this.onError(e);

        return;
      }

      // TODO: Make sure it was succesfull & the content type is JSON

      this.result = JSON.parse(xhr.responseText);
      this.status = UploadStatus.Completed; 
      
      if (xhr.status == 201) {
        // Last one (Finalized)
      }
      else {
        // partial upload
      }

      this.progress.loaded = this.size;
      
      // Final progress notification
      if (this.onprogress) {
        this.onprogress(this.progress);
      }
      
      this.defer.resolve(this);
    }

    private onError(e: ErrorEvent) {
       this.status = UploadStatus.Error;
       this.error = e.error;
       
       this.defer.reject(this);
    }

    private onAbort(e) {
      this.status = UploadStatus.Canceled;

      this.defer.reject(this);
    }
  }


  export class FileInput {
    element: HTMLInputElement;
    reactive = new Reactive();

    constructor(element: Element | string, options) {
      if (typeof element === 'string') {
        this.element = <HTMLInputElement>document.querySelector(element);
      }
      else {
  		  this.element = <HTMLInputElement>element;
      }

      if (!this.element) throw new Error('[FileInput] element not found');
      
      this.element.addEventListener('change', this.onChange.bind(this), false);

      if (options) {
        if (options.accept) {
          this.element.setAttribute('accept', options.accept)
        }

        if (options.multiple) {
          this.element.setAttribute('multiple', 'true');
        }
      }
    }

    subscribe(callback) {
      return this.reactive.subscribe(callback);
    }

    clear() {
      // Clear the file input in all browsers except IE
      if (navigator.userAgent && navigator.userAgent.indexOf('MSIE') === -1) {
        this.element.value = '';
      }
    }

    setAccept(formats: string[]) {
      this.element.setAttribute('accept', formats.map(f => '.' + f).join(','));
    }

    onChange(e: Event) {
      let files = this.element.files;

      if (files.length == 0) return;

      this.reactive.trigger(files);
    }
  }

  let FileUtil = {
    scales: [ 'B', 'KB', 'MB', 'GB' ],

    getFormatFromName(name: string) {
      let split = name.split('.');

      return split[split.length - 1];
    },

    threeNonZeroDigits(value: number) {
      if (value >= 100) return Math.floor(value);
      
      if (value >= 10) {
        return Math.round(value * 10) / 10;
      }
      else {
        return Math.round(value * 100) / 100;
      }
    },

    formatBytes(byteCount: number) {
      let i = 0;
      let base = 1000;
      let value = byteCount;

      while ((base - 1) < value) {
        value /= base;
        i++;
      }

      return FileUtil.threeNonZeroDigits(value) + " " + FileUtil.scales[i];
    }
  };

  let fileFormats = {
    aac  : 'audio',
    aiff : 'audio',
    flac : 'audio',
    m4a  : 'audio',
    mp3  : 'audio',
    oga  : 'audio',
    opus : 'audio',
    wav  : 'audio',
    wma  : 'audio',

    bmp  : 'image',
    cr2  : 'image',
    jpg  : 'image',
    jpeg : 'image',
    gif  : 'image',
    ico  : 'image',
    png  : 'image',
    psd  : 'image',
    svg  : 'image',
    tif  : 'image',
    tiff : 'image',

    usdz : 'model',

    avi  : 'video',
    f4v  : 'video',
    flv  : 'video',
    mkv  : 'video',
    mv4  : 'video',
    mpg  : 'video',
    mpeg : 'video',
    mov  : 'video',
    mp4  : 'video',
    ogg  : 'video',
    ogv  : 'video',
    qt   : 'video',
    webm : 'video',
    wmv  : 'video',

    eof   : 'font',
    woff  : 'font',
    woff2 : 'font',

    ai   : 'application',
    pdf  : 'application'
  };

  let mimes = {
    usdz  : 'model/vnd.usd+zip',
    woff  : 'font/woff',
    woff2 : 'font/woff2' 
  };

  interface UploadResult {
    id         : string,
    name       : string,
    size       : number,
    hash       : string,
    transfered : number
  };
  
  export interface Picker {
    subscribe(callback: Function);
    clear?();
    setAccept?(formats: string[]);
  }


  export class Reactive {
    

    key: string;
    listeners: Array<Listener> = [];
    
    constructor(key?: string) {
      this.key = key;
    }

    on(name: string, callback: Function) : Listener {
      return this.subscribe(callback, e => e.type == name);
    }

    off(name: string) {
      for (var listener of Array.from(this.listeners)) {
        if (listener.filter && listener.filter({ type: name })) {
          listener.dispose();
        }
      }
    }

    once(name: string, callback) {
      return this.subscribe(callback, {
        filter : e => e.type == name,
        once   : true
      });
    }

    subscribe(callback, options?: ListenerOptions) {
      let listener = new Listener(callback, this, options);

      this.listeners.push(listener);

      return listener;
    }

    unsubscribe(listener) {
      let index = this.listeners.indexOf(listener);

      if (index > -1) {
        this.listeners.splice(index, 1);

        if (this.listeners.length == 0) {
          this.dispose();
        }
      }
    }

    trigger(e, data?: any) {
     if (typeof e == "string") {
        var d = { type: e };

        if (data) {
          Object.assign(d, data);
          data = null;
        }

        e = d;
     }
     
     for (var listener of Array.from(this.listeners)) {
      listener.fire(e, data);
     }
    }

    dispose() {
      while (this.listeners.length > 0) {
       this.listeners.pop();
      }
    }
  }

  interface ListenerOptions {
    scope?  : string;
    once?   : boolean;
    filter? : (e) => boolean;
  }

  export class Listener {
    callback: Function;
    reactive: Reactive;
    fireCount = 0;

    once: boolean;
    lastFired: Date;
    filter: (e) => boolean;
    scope: any;

    active = true;

    constructor(callback: Function, reactive: Reactive, optionsOrFilter: ListenerOptions|((e) => boolean)) {
      this.reactive = reactive;
      this.callback = callback;

      if (typeof optionsOrFilter === 'function') {
        this.filter = <(e:any) => boolean>optionsOrFilter;
      }
      else if (optionsOrFilter) {
        let options: ListenerOptions = optionsOrFilter;

  	    this.scope  = options.scope;
  	    this.filter = options.filter;
  	    this.once = options.once;
  	  }
    }

    fire(e, data?) {
      if (!this.active) return;

      if (this.filter && !this.filter(e)) return;

      this.callback(e, data || this);

      this.lastFired = new Date();
      this.fireCount++;

      if (this.once) {
        this.dispose();
      }
    }

    pause() {
      this.active = false;
    }

    resume() {
      this.active = true;
    }

    dispose() {
      this.active = false;

      this.reactive.unsubscribe(this);
    }
  }

  class Deferred<T> {
    private _resolve: Function;
    private _reject: Function;
    
    promise: Promise<T>;
    
    constructor() {
      this.promise = new Promise((resolve, reject) => {
        this._resolve = resolve
        this._reject = reject
      });
    }

    resolve(value?: any) {
      this._resolve(value);
    }
    
    reject(value?: any) { 
      this._reject(value);
    }
  }



  if (Array.prototype.remove === undefined) {
    Array.prototype.remove = function(item) {
      var index = this.indexOf(item);

      if (index != -1) {
        this.splice(index, 1);
      }
    };
  }

