"use strict";

module Carbon {
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

  export class ProgressMeter {
    barEl: HTMLElement;
    percentEl: Element;
    inversed: boolean;

    constructor(element: HTMLElement) {
      this.barEl     = <HTMLElement>element.querySelector('.bar');
      this.percentEl = element.querySelector('.percent');

      this.inversed = this.barEl.matches('.inversed');
    }

    observe(manager: UploadManager) {
      manager.on('progress', this.update.bind(this));
    }

    reset() {
      this.barEl.style.width = '0%';

      if (this.percentEl) {
        this.percentEl.innerHTML = '0%';
      }
    }

    update(progress: Progress) {
      this.setValue(progress.value);
    }

    setValue(value) {
      let percent = Math.round(value * 100);

      if (this.inversed) percent = 100 - percent;

      this.barEl.style.width = percent + '%';

      if(this.percentEl) {
        this.percentEl.innerHTML = percent + '%';
      }
    }
  }

  export class BatchProgressMeter {
    element: HTMLElement;
    width: number;
    meter: ProgressMeter;

    constructor(element: HTMLElement) {
      this.element = element;
      this.width = this.element.clientWidth;

      this.meter = new ProgressMeter(this.element);
    }

    observe(manager: UploadManager) {
      manager.on('progress', this.meter.update.bind(this.meter));
      
      manager.on('queue', e => {
        this.setUploads(e.uploads);
      });
    }

    reset() {
      this.meter.reset();
    }

    setUploads(uploads: Upload[]) {
      this.width = this.element.clientWidth;

      let condenceWidth = 50;
      let colaposedWidth = 20;

      let condencedPercent = condenceWidth / this.width;
      let colaposedPercent = colaposedWidth / this.width;

      let filesEl = this.element.querySelector('.files');

      filesEl.innerHTML = '';

      let totalSize = uploads.map(u => u.size).reduce((c, n) => c + n);

      let fileTemplate = Carbon.Template.get('fileTemplate');

      // Figure out the widths
      uploads.forEach((file: any) => {
        file.batchPercent = file.size / totalSize;

        if (file.batchPercent <= condencedPercent) {
          file.condenced = true;
        }
      });

      let nonCondeced = uploads.filter((u: any) => !u.condenced);

      // Pass 2
      uploads.forEach((file: any) => {
        if (nonCondeced.length == 0) {
           file.batchPercent = 1 / uploads.length;
        }
        else if (file.condenced) {
          let toGive = file.batchPercent - colaposedPercent;

          file.batchPercent = colaposedPercent;

          file.condenced = true;

          // Distribute equally amongest the non-condencesed uploads
          let distribution = toGive / nonCondeced.length;

          nonCondeced.forEach((b: any) => {
            b.batchPercent += distribution;
          });
        }
      });

      // Build up the DOM
      uploads.forEach(file => {
        let fileEl = fileTemplate.render({ 
          name: file.name, 
          size: FileUtil.formatBytes(file.size) 
        });

        fileEl.style.width = (file.batchPercent * 100) + '%';

        if (file.condenced) {
          fileEl.classList.add('condensed');
        }
        
        filesEl.appendChild(fileEl);

        file.element = fileEl;

        file.defer.promise.then(e => { 
          file.element.classList.add('completed');
         });
      });
    }
  }

  /*
  <li class="file {if(completed,"completed")} {if(condensed, "condensed")}" style="width: {percent.format("0.0")}%">
    <span class="name">{name}</span>

    <span class="info">
      <i class="name">{name}</i>
      <i class="size">{sizeFormatted}</i>
    </span>

    <span class="size">{sizeFormatted}</span>
    <span class="done">&#xe048;</span>
  </li>
  */

  // TODO: CountdownEvent (Represents a synchronization primitive that is signaled when its count reaches zero.)

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

    reactive = new Carbon.Reactive();

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

      // Limit check
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

      upload.start().then(
         /*success*/ () => {
           
           console.log('upload completed');
           
          this.completedCount++;

          this.notify();

          this.uploadNext();
        },
        /*error*/ () => {
          this.canceledCount++;
          
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
    authorization: string;
    retryCount: number = 0;
    method: string;
    debug = false;
    chunkSize = 1024 * 1024 * 5; // 5MiB
    progress: Progress;

    offset: number;
    chunkNumber: number;
    chunkCount: number;

    rejected = false;
    rejectionReason: string;

    id: string;
    response: any;
    xhr: XMLHttpRequest;

    reactive = new Carbon.Reactive();
    
    element: HTMLElement;

    defer = new Deferred<any>();
    promise: Promise<any>;
    
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

    start(): Promise<UploadResponse> {
      if (this.status >= 2) { 
        return Promise.reject('[Upload] already started');
      }
     
      if (this.type.startsWith('image')) {
        this.chunkSize = this.size;
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

      let data;

      if (this.file.slice) {
        data = this.file.slice(start, end);
      }
      else if (this.file.webkitSlice) {
        data = this.file.webkitSlice(start, end);
      }

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
      // TODO: Use expodential backoff
      if (this.retryCount < 3) {
        this.retryCount++;

        setTimeout(this.next.bind(this), 1000);
      }
      else {
        this.onError(chunk);
      }
    }

    private onChunkUploaded(chunk: UploadChunk) {
      this.chunkNumber++;
      this.offset += chunk.size;

      this.response = chunk.response;
      this.id = chunk.response.id;

      this.retryCount = 0;

      if (this.offset == this.size) {
        
        console.log('file uploaded', chunk);
        // We're done
        
        this.reactive.trigger({ type: 'complete' });
        
        this.defer.resolve(this.response);
      }
      else {
         // Update the url for subsequent uploads
        this.url = (this.baseUri + this.response.id);

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

      this.defer.reject();
    }

    private onAbort(e) {
      this.status = UploadStatus.Canceled;

      this.reactive.trigger({ type: 'abort' });

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


    onChange(transport) {
      if (this.xhr.readyState !== 4) { }
    }

    get format() {
      return FileUtil.getFormatFromName(this.name).toLowerCase();
    }

    getFormattedSize() {
      return FileUtil.formatBytes(this.size);
    }

    getPreview() {
      return new FilePreview(this.file);
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
    response: any;
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

    send(options) : Promise<UploadChunk> {
      // TODO: use fetch if supported natively...

      let xhr = new XMLHttpRequest();

      xhr.addEventListener('load'  , this.onLoad.bind(this),  false);
      xhr.addEventListener('error' , this.onError.bind(this), false);
      xhr.addEventListener('abort' , this.onAbort.bind(this), false);

      xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);

      xhr.open(options.method, options.url, true);

      xhr.setRequestHeader('Content-Type' , this.file.type.replace('//', '/'));

      if (options.authorization) {
        xhr.setRequestHeader('Authorization', options.authorization)
      }

      // File details 
      xhr.setRequestHeader('X-File-Name', encodeURI(this.file.name));            // Encode to support unicode 完稿.jpg

      /*
      X-Upload-Content-Type: image/jpeg
      X-Upload-Content-Length: 2000000
      */

      let range = { 
        start : this.offset,
        end   : Math.min(this.offset + this.file.chunkSize, this.file.size),
        total : this.file.size
      };

      // bytes 43-1999999/2000000

      // Content-Range : 0-10000
      xhr.setRequestHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      
      xhr.send(/*blob*/ this.data);  // Chrome7, IE10, FF3.6, Opera 12

      this.status = UploadStatus.Uploading;
      
      return this.defer.promise;
    }

    private onProgress(e: ProgressEvent) {
      if (!e.lengthComputable) return;

      this.progress.loaded = e.loaded;

      if (this.onprogress) this.onprogress(this.progress);
    }

    private onLoad(e) {
      console.log('loaded chuck', e);

      let xhr = e.target;

      if (xhr.readyState !== 4) {
        this.onError(e);

        return;
      }

      // TODO: Make sure it's a valid status

      // TODO: Check content type to make sure it's json
    
      this.response = JSON.parse(xhr.responseText);

      this.status = UploadStatus.Completed; 
      
      if (xhr.status == 201) {
        // Last one (Finalized)
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

  export class DropHandler {
    static instance = new DropHandler(); // Initilaize drop handler

    currentDropElement: any;

    constructor() {
      document.addEventListener('dragenter', this.onDragEnter.bind(this), false);
      document.addEventListener('dragover',  this.onDragOver.bind(this),  false);
      document.addEventListener('dragleave', this.onDragLeave.bind(this), false);
      document.addEventListener('drop',      this.onDrop.bind(this),      false);

      this.currentDropElement = null;
    }

    onDragEnter(e: DragEvent) {
      // entering target element

      let target = <Element>e.target;

      let dropElement = this.getDropElement(target);

      if (dropElement) {
        // Force hide all other drop elements
        
        Array.from(document.querySelectorAll('.dragOver')).forEach(el => {
          el.classList.remove('dragOver');
        });
        
        dropElement.classList.add('dragOver');

        this.currentDropElement = dropElement;
      }

      e.preventDefault();
      e.stopPropagation();

      e.dataTransfer.dropEffect = 'copy';
    
      trigger(target, 'carbon:dragenter', { element: dropElement });
    }

    onDragOver(e: DragEvent) {
      e.preventDefault(); // ondrop event will not fire in Firefox & Chrome without this

      e.dataTransfer.dropEffect = 'copy';

      trigger(<Element>e.target, 'carbon:dragover');
    }

    onDragLeave(e: DragEvent) { // leaving target element
      // console.log('enter', e.target);

      if (!this.currentDropElement) return;

      let box = this.currentDropElement.getBoundingClientRect();

      if ((e.y < box.top) || (e.y > box.bottom) || (e.x < box.left) || (e.x > box.right)) {
        this.currentDropElement.classList.remove('dragOver');

        this.currentDropElement = null;
      }

      trigger(<Element>e.target, 'carbon:dragleave');
    }

    onDrop(e: DragEvent) {
      e.preventDefault();
      
      var target = <Element>e.target;
      let files = e.dataTransfer.files;
      let items = e.dataTransfer.items;
      let dropElement = this.getDropElement(target);

      if (dropElement) {
        dropElement.classList.remove('dragOver');
      }
      
      if (files.length == 0) return;
      
      let detail = {
        files   : files,
        items   : items,
        element : dropElement || document.body
      }
      
      trigger(detail.element, 'carbon:drop', detail);
    }

    getDropElement(target: Element) {
      if (target.getAttribute('on-drop')) return target;

      // Look upto 5 level up
      for (var i = 0; i < 5; i++) {
        target = target.parentElement;

        if (!target) return null;

        if (target.getAttribute('on-drop')) return target;
      }

      return null;
    }
  }

  export class FileDrop implements Picker {
    element: Element;
    options: any;

    reactive = new Carbon.Reactive();

  	constructor(element: Element|string, options = { }) {
      if (typeof element === 'string') {
        this.element = document.querySelector(element);
      }
      else {
  		  this.element = element;
      }
      
      if (!this.element) throw new Error('[FileDrop] element not found');
           
      this.options = options;

      if (this.element.matches('.setup')) return;

      this.element.classList.add('setup');

      if (!this.element.getAttribute('on-drop')) {
        this.element.setAttribute('on-drop', 'pass');
      }

      this.element.addEventListener('carbon:drop', (e: CustomEvent) => {
        this.reactive.trigger(e.detail.files);
      });
  	}

    subscribe(callback) {
      return this.reactive.subscribe(callback);
    }

    clear() { }

    setAccept(formats) {
      this.options.accept = formats;
    }
  }

  export class FileInput {
    element: HTMLInputElement;
    reactive = new Carbon.Reactive();

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

  export class FilePreview {
    file: any;
    image: HTMLImageElement;
    type: string;

    loaded = false;

    constructor(file) {
      this.file = file;

      this.type = file.type;

      this.image = new Image();
    }

    getURL() {
      if (this.type.indexOf('image') < 0) {
        console.log('Expected image. Was ' + this.type);
      };

      return URL.createObjectURL(this.file);
    }

    load() : Promise<any> {
      // TODO: Subsample images in iOS
      
      
      if(this.loaded) {
        return Promise.resolve(this.image);
      }

      // TODO: Ensure we we do not read while uploading
      
      return new Promise((resolve, reject) => { 
        let reader = new FileReader();

        reader.onloadend = () => {
          this.image.src = reader.result;

          this.image.onload = () => {
            this.loaded = true;

            resolve(this.image);
          }

          this.image.onerror = () => {
            reject();
          }
        };

        reader.onerror = () => { 
          reject();
        }

        reader.readAsDataURL(this.file);
      });
    }

    resize(maxWidth: number, maxHeight: number) : PromiseLike<any> {
      // TODO: Apply EXIF rotation

      return this.load().then(image => {
        let size = Util.fitIn(image.width, image.height, maxWidth, maxHeight);

        let canvas = document.createElement('canvas');

        canvas.width = size.width;
        canvas.height = size.height;

        let ctx = canvas.getContext("2d");

        ctx.drawImage(image, 0, 0, size.width, size.height);

        let data = canvas.toDataURL('image/png');

        return Promise.resolve({
          width  : size.width,
          height : size.height,
          data   : data,
          url    : data
        });
      });
    }
  }

  var Util = {
    fitIn(width: number, height: number, maxWidth: number, maxHeight: number) {
    	if (height <= maxHeight && width <= maxWidth) {
    		return { width: width, height: height }
    	}

   		let mutiplier = (maxWidth / width);

   		if (height * mutiplier <= maxHeight) {
  		  return {
    		  width: maxWidth,
    		  height: Math.round(height * mutiplier)
  		  }
     	}
  		else {
      	mutiplier = (maxHeight / height);

       	return {
    		  width: Math.round(width * mutiplier),
    		  height:  maxHeight
  		  }
  		}
    }
  }

  var FileUtil = {
    scales: ['B', 'KB', 'MB', 'GB'],

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

  var fileFormats = {
    aac  : 'audio',
    aiff : 'audio',
    flac : 'audio',
    m4a  : 'audio',
    mp3  : 'audio',
    oga  : 'audio',
    wav  : 'audio',
    wma  : 'audio',

    bmp  : 'image',
    jpg  : 'image',
    jpeg : 'image',
    gif  : 'image',
    ico  : 'image',
    png  : 'image',
    psd  : 'image',
    svg  : 'image',
    tif  : 'image',
    tiff : 'image',

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

    ai   : 'application',
    pdf  : 'application',
    swf  : 'application'
  };

  interface UploadResponse {
    id: string,
    name: string,
    size: number,
    hash: string,
    transfered: number
  };

  // Upload a file from a url
  export class UrlUpload {
    url: string;
    status: UploadStatus;
    type: string;
    progress: Progress = new Progress(0, 100);
    defer = new Deferred<any>();
    response: UploadResponse;
    reactive = new Carbon.Reactive();
    promise: Promise<any>;
    
    name: string;
    size: number;
    source: string;
    thumbnailUrl: string;
    format: string;
    
    constructor(url, options?: { name: string, size: number }) {
      this.url = url;
      this.status = 0;
      
      this.promise = this.defer.promise;
      
      if (options && options.name) {
        this.name = options.name;
        this.format = this.name.substring(this.name.lastIndexOf('.') + 1);
      }
      else {
         this.format = this.url.substring(this.url.lastIndexOf('.') + 1);
      }
      
      if (options && options.size) {
        this.size = options.size;
      }
      
      this.type = fileFormats[this.format] + '/' + this.format;
    }

    private onProgress(e) {
      this.progress.loaded = e.loaded;

      this.reactive.trigger({
        type   : 'progress',
        loaded : this.progress.loaded,
        total  : this.progress.total,
        value  : this.progress.value        
      });
      
      if (e.loaded < 100) {
        setTimeout(() => {
          this.onProgress({ loaded: e.loaded + 1 });
        }, 10);
      }
    }

    on(name: string, callback: Function) {
      this.reactive.on(name, callback);
    }

    start(): PromiseLike<UploadResponse> {      
      let request = fetch('https://uploads.carbonmade.com/', {
        mode: 'cors',
        method: 'POST',
        body: `url=${this.url}`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }).then(response => response.json());

      request.then(this.onDone.bind(this));

      // TODO, add id & open up web socket to monitor progress
      
      this.onProgress({ loaded: this.progress.loaded });

      this.reactive.trigger({ type : 'start' });

      return this.defer.promise;
    }

    onDone(data: UploadResponse) {
      this.status = UploadStatus.Completed;
      this.response = data;

      this.defer.resolve(data);
    }
  }
  
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
  
  export interface Picker {
    subscribe(callback: Function);
    clear?();
    setAccept?(formats: string[]);
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

function trigger(element: Element | Window, name: string, detail?): boolean {
  return element.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail: detail
  }));
}
