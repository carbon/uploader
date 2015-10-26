module Carbon {
  "use strict";

  // W3 Progress Event
  export class Progress {
    loaded: number;
    total: number;

    constructor(loaded: number, total: number) {
      this.loaded = loaded;
      this.total = total;
    }

    get value() {
      return (this.total != 0) ? this.loaded / this.total : 0;
    }

    toString() {
      return Math.round(this.value * 100) + "%";
    }
  }

  export class ProgressMeter {
    barEl: HTMLElement;
    percentEl: HTMLElement;
    inversed: boolean;

    constructor(element) {
      var el = $(element)[0];

      this.barEl     = el.querySelector('.bar');
      this.percentEl = el.querySelector('.percent');

      this.inversed = this.barEl.classList.contains('inversed');
    }

    observe(manager) {
      manager.progress(this.update.bind(this));
    }

    reset() {
      this.barEl.style.width = '0%';
      this.percentEl.innerHTML = '0%';
    }

    update(progress) {
      this.setValue(progress.value);
    }

    setValue(value) {
      var percent = Math.round(value * 100);

      if (this.inversed) percent = 100 - percent;

      this.barEl.style.width = percent + '%';

      if(this.percentEl) {
        this.percentEl.innerHTML = percent + '%';
      }
    }
  }

  export class BatchProgressMeter {
    element: any;
    width: number;
    meter: ProgressMeter;

    constructor(element: HTMLElement) {
      this.element = $(element);
      this.width = this.element.width();

      this.meter = new ProgressMeter(this.element[0]);
    }

    observe(manager) {
      manager.progress(this.meter.update.bind(this.meter));

      manager.on('queued', e => {
        this.setUploads(e.uploads);
      });
    }

    reset() {
      this.meter.reset();
    }

    setUploads(files) {
      this.width = this.element.width();

      var condenceWidth = 50;
      var colaposedWidth = 20;

      var condencedPercent = (condenceWidth / this.width);
      var colaposedPercent = (colaposedWidth / this.width);

      var filesEl = this.element.find('.files');

      filesEl.html('');

      var totalSize = files.map(u => u.size).reduce((c, n) => c + n);

      var fileTemplate = Carbon.Template.get('fileTemplate');

      // Figure out the widths
      files.forEach(upload => {
        upload.batchPercent = upload.size / totalSize;

        if (upload.batchPercent <= condencedPercent) {
          upload.condenced = true;
        }
      });

      var nonCondeced = files.filter(u => !u.condenced);

      // Pass 2
      files.forEach(upload => {
        if (nonCondeced.length == 0) {
           upload.batchPercent = 1 / files.length;
        }
        else if (upload.condenced) {
          var toGive = upload.batchPercent - colaposedPercent;

          upload.batchPercent = colaposedPercent;

          upload.condenced = true;

          // Distribute equally amongest the non-condencesed uploads
          var distribution = toGive / nonCondeced.length;

          nonCondeced.forEach(b => {
            b.batchPercent += distribution;
          });
        }
      });

      // Build up the DOM
      files.forEach(file => {
        var fileEl = fileTemplate.render({ name: file.name, size: FileUtil.formatBytes(file.size) });

        fileEl.css('width', (file.batchPercent * 100) + '%');

        if (file.condenced) {
          fileEl.addClass('condensed');
        }

        fileEl.appendTo(filesEl);

        file.element = fileEl;

        file.done(e => { file.element.addClass('completed'); });
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

  // Represents a synchronization primitive that is signaled when its count reaches zero.

  class CountdownEvent {
    currentCount: number;
    defer: any;

    constructor(initialCount) {
      this.currentCount = initialCount || 0;

      this.defer = new $.Deferred();

      this.defer.promise(this);
    }

    addCount() {
      this.currentCount++;
    }

    signal() {
      this.currentCount--;

      if(this.currentCount == 0) {
        this.resolve();
      }
    }
  }

  export class UploadBatch {
    queued: Array<Upload> = [];
    rejected: Array<Upload> = [];

    constructor() {

    }
  }

  export class UploadManager {
    static supported = !!(window.File && window.FileList && window.Blob && window.FileReader);

    status = UploadStatus.Pending;
    defer: any;
    subscriptions = [];

    options: any;

    uploads: Array<Upload>;
    queue: Array<Upload>;

    completedCount = 0;
    canceledCount = 0;

    debug: boolean;

    uploadLimit: number;

    accept: any;

    _progress: Progress;

    reactive = new Carbon.Reactive();

    constructor(options = { }) {
      this.options = options;
      this.reset();

      this.defer = new $.Deferred();

      this.defer.promise(this);

      this.debug = this.options.debug || false;

      // options.accept = [ 'gif', 'jpeg', ... ]

      this.uploadLimit = options.uploadLimit || 1000;
      this.accept = options.accept;

      if (this.uploadLimit < 0) {
        this.uploadLimit = 0;
      }

      if (this.options.inputs) {
        for (var i = 0; i < this.options.inputs.length; i++) {
          this.addSource(this.options.inputs[i]);
        }
      }
    }

    on(nameOrObject, callback?: Function) {
      // { type: function, type: function } ...
      if (typeof nameOrObject == 'object') {
        var keys = Object.keys(nameOrObject);

        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];

          this.reactive.on(key, nameOrObject[key]);
        }
      }
      else {
        return this.reactive.on(nameOrObject, callback);
      }
    }

    addSource(source) {
      // sources may be file inputs or drops

      // Configure accept
      if (this.accept && source.setAccept) {
        source.setAccept(this.accept);
      }

      var subscription = source.subscribe(this.addFiles.bind(this));

      // Subscribe to the sources files
      this.subscriptions.push(subscription);
    }

    accepts(format) {
      if (!this.options.accept) return true;

      return this.options.accept.filter(f => f == format).length > 0;
    }

    queueFile(file) {
      var upload = new Upload(file, this.options);

      upload.manager = this;

      // Format check
      if (!this.accepts(upload.getFormat())) {
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

      return upload;
    }

    addFiles(files: FileList) {
      var batch = new UploadBatch();

      if (!files || files.length == 0) return batch;

      for (var i = 0, len = files.length; i < len; i++) {
        var upload = this.queueFile(files[i]);

        if (upload.rejected) {
          batch.rejected.push(upload);
        }
        else {
          batch.queued.push(upload);
        }
      }

      this._trigger({
        type     : 'selection',
        queued   : batch.queued,
        rejected : batch.rejected
      });

      this._trigger({
        type     : 'picked',
        queued   : batch.queued,
        rejected : batch.rejected
      });

      return batch;
    }

    removeUpload(upload) {
      this.queue.remove(upload);
      this.uploads.remove(upload);

      this.reactive.trigger({
        type: 'uploadRemoved'
      }, upload);
    }

    reset() {
      this.queue = [];
      this.uploads = [];

      this._progress = new Progress(0, 0);

      this.completedCount = 0;
      this.canceledCount = 0;

      if (this.options.inputs) {
        this.options.inputs.forEach(u => { u.clear(); });
      }
    }

    setUploadLimit(value) {
      this.uploadLimit = value;

      if (this.debug) {
        console.log('Upload limit set: ' + value);
      }
    }

    start() {
      this.status = UploadStatus.Uploading; // processing

      this.reactive.trigger({ type: 'started' });

      this.uploadNext();
    }

    uploadNext() {
      if (this.queue.length == 0) {
        this.status = UploadStatus.Completed; // done

        // We've completed the queue
        this._trigger({
          type    : 'done',
          uploads : this.uploads
        });

        return;
      }

      var upload = this.queue.shift();

      upload.progress(() => {
        var loaded = 0;
        var total = 0;

        for (var i = 0, len = this.uploads.length; i < len; i++) {
          loaded += this.uploads[i]._progress.loaded;
          total  += this.uploads[i].size;
        }

        this._progress.loaded = loaded;
        this._progress.total = total;

        this.defer.notify(this._progress);
      });

      upload.then(
        () => { /*success*/
          this.completedCount++;

          this.defer.notify(this._progress);

          setTimeout(this.uploadNext.bind(this), 0);
        },
        () => { /*error*/
          this.canceledCount++;

          // Upload canceled. Start the next one immediatly
          this.defer.notify(this._progress);

          setTimeout(this.uploadNext.bind(this), 0);
        }
      );

      upload.start();
    }

    cancel() {
      // Cancel any uploads in progress
      this.uploads.forEach(u => { u.cancel(); });

      this.status = UploadStatus.Canceled; // canceled

      this._trigger({ type: 'canceled' });
    }

    _trigger(e, data?) {
      this.reactive.trigger(e, data);
    }

    dispose() {
      this.cancel();
    }
  }

  enum UploadStatus {
    Pending = 1,
    Uploading = 2,
    Completed = 3,
    Canceled = 4,
    Error = 5
  }

  interface UploadOptions {
    url: string;
    method?: string;
  }

  export class Upload {
    name: string;
    size: number;
    type: string;
    file; any;
    status = UploadStatus.Pending;
    baseUri: string;
    url: string;
    defer: any;
    retryCount: number = 0;
    method: string;
    debug = false;
    chunkSize = 5242880; // 5MB
    _progress: Progress;

    offset: number;
    chunkNumber: number;
    chunkCount: number;

    rejected?: boolean;
    rejectionReason?: string;

    id: string;
    response: any;
    xhr: XMLHttpRequest;

    reactive = new Carbon.Reactive();

    constructor(file, options: UploadOptions) {
      if (!file) throw new Error('file is empty');

      this.file = file;

      this.name = this.file.name;
      this.size = this.file.size;
      this.type = this.file.type; /* Mime type */

      // note: progress is already implemented by deferred
      this._progress = new Progress(0, this.size);

      // Options

      this.method = options.method || 'POST';
      this.url = options.url;

      this.baseUri = this.url;

      this.defer = new $.Deferred();

      this.defer.promise(this);
    }

    on(name, callback) {
      return this.reactive.on(name, callback);
    }

    start() {
      if (this.status >= 2) alert('already started');

      if(this.type.indexOf('image') > -1) {
        this.chunkSize = this.size;
      }

      this.offset = 0;
      this.chunkNumber = 1;
      this.chunkCount = Math.ceil(this.size / this.chunkSize);

      this.next();

      this.status = UploadStatus.Uploading;

      this.reactive.trigger( { type: 'started' });

      return this.defer;
    }

    next() {
      if (this.offset + 1 >= this.size) return;

      if (this.chunkCount > 1) {
        console.log('"' + this.name + '" uploading ' + this.chunkNumber + ' of ' +  this.chunkCount + ' chunks.');
      }

      var start = this.offset;
      var end = this.offset + this.chunkSize;

      var data;

      if (this.file.slice) {
        data = this.file.slice(start, end);
      }
      else if (this.file.mozSlice) {
        data = this.file.mozSlice(start, end);
      }
      else if (this.file.webkitSlice) {
        data = this.file.webkitSlice(start, end);
      }

      var chunk = new UploadChunk(this, data);

      chunk.progress(this.onProgress.bind(this));

      chunk.send(this).then(
        /*success*/ this.onChunkUploaded.bind(this),
        /*fail*/    this.onChunkFailed.bind(this)
      );
    }

    onChunkFailed(chunk) {
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

    onChunkUploaded(chunk) {
      this.chunkNumber++;
      this.offset += chunk.size;

      this.response = chunk.response;
      this.id = chunk.response.id;

      this.retryCount = 0;

      // DONE!
      if (this.offset == this.size) {
        this.defer.resolve(this.response);
      }
      else {
         // Update the url for subsequent uploads
        this.url = (this.baseUri + this.response.id);

        this.next();
      }
    }

    cancel() {
      if(this.status == UploadStatus.Canceled) return;

      if(this.xhr && this.status != 4) {
        this.xhr.abort();
      }

      this.status = UploadStatus.Canceled;

      this.reactive.trigger({ type : 'canceled' });

      this.defer.reject();

      if(this.manager) {
        this.manager.removeUpload(this);
      }
    }

    // Overall progress
    onProgress(e: Progress) {
      this._progress.loaded = e.loaded + this.offset;

      this.reactive.trigger({
        type: 'progress'
      }, this._progress);

      this.defer.notify(this._progress);
    }

    onError(e) {
      console.log('upload error', e);

      this.status = UploadStatus.Error;
      this.error = true;

      this.defer.reject();
    }

    onAbort(e) {
      this.status = UploadStatus.Canceled;

      this.reactive.trigger({ type: 'aborted' });

      this.defer.reject();
    }

    onChange(transport) {
      if (this.xhr.readyState !== 4) { }
    }

    getFormat() {
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
    file: any;
    data: any;
    size: number;
    offset: number;
    number: number;
    _progress: Progress;
    status: number;
    defer: any;

    xhr: XMLHttpRequest;
    response: any;

    constructor(file, data) {
      this.status = 1; // pending
      this.file = file;

      this.data = data;

      this.size = data.size;
      this.offset = file.offset;
      this.number = file.chunkNumber;

      if(this.size == 0) throw new Error('No data')

      // note: progress is already implemented by deferred
      this._progress = new Progress(0, this.data.size);

      this.defer = new $.Deferred();

      this.defer.promise(this);
    }

    send(options) {
      var xhr = new XMLHttpRequest();

      xhr.addEventListener('load'  , this.onLoad.bind(this),  false);
      xhr.addEventListener('error' , this.onError.bind(this), false);
      xhr.addEventListener('abort' , this.onAbort.bind(this), false);

      xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);

      xhr.open(options.method, options.url, true);

      xhr.setRequestHeader('Content-Type'   , 'text/plain');                      // Required for safari

      // File details
      xhr.setRequestHeader('X-File-Name' , encodeURI(this.file.name));            // Encode to support unicode 完稿.jpg
      xhr.setRequestHeader('X-File-Type' , this.file.type.replace('//', '/'));
      xhr.setRequestHeader('X-File-Size' , this.file.size);

      // Chunk details
      xhr.setRequestHeader('X-Chunk-Count'  , this.file.chunkCount);
      xhr.setRequestHeader('X-Chunk-Offset' , this.offset);
      xhr.setRequestHeader('X-Chunk-Size'   , this.size);
      xhr.setRequestHeader('X-Chunk-Number' , this.number);

      xhr.send(/*blob*/ this.data);  // Chrome7, IE10, FF3.6, Opera 12

      this.xhr = xhr;

      this.status = UploadStatus.Uploading;

      return this.defer;
    }

    onProgress(/*XMLHttpRequestProgressEvent*/ e) {
      if (!e.lengthComputable) return;

      this._progress.loaded = e.loaded;

      this.defer.notify(this._progress);
    }

    onLoad(e) {
      var xhr = e.target;

      if (xhr.readyState !== 4) {
        this.onError(e);

        return;
      }

      this.status = xhr.status;

      // TODO: Make sure it's a valid status

      this.response = xhr.response;

      // TODO: Check content type to make sure it's json
      if(xhr.responseText) {
        this.response = JSON.parse(xhr.responseText);
      }

      this.status = 3; // done

      if(xhr.status == 201) {
        // Last one (Finalized)
      }

      this._progress.loaded = this.size;

      // Final progress notification
      this.defer.notify(this._progress);
      this.defer.resolve(this);
    }

    onError(e) {
       this.error = true;

       this.defer.reject(this);
    }

    onAbort(e) {
      this.status = UploadStatus.Canceled;

      this.defer.reject(this);
    }
  }

  export class DropHandler {
    static instance = new DropHandler(); // Initilaize drop handler

    currentDropElement: any;

    constructor() {
      var el = document.body;

      el.addEventListener('dragenter', this.onDragEnter.bind(this), false);
      el.addEventListener('dragover',  this.onDragOver.bind(this),  false);
      el.addEventListener('dragleave', this.onDragLeave.bind(this), false);
      el.addEventListener('drop',      this.onDrop.bind(this),      false);

      this.currentDropElement = null;
    }

    onDragEnter(e) {
      // entering target element

      var target = e.target;

      var dropElement = this.getDropElement(target);

      if (dropElement) {
        // Force hide all other drop elements

        $('.dragOver').removeClass('dragOver');

        dropElement.classList.add('dragOver');

        this.currentDropElement = dropElement;
      }

      e.preventDefault();
      e.stopPropagation();

      e.dataTransfer.dropEffect = 'copy';
    }

    onDragOver(e) {
      e.preventDefault(); // ondrop event will not fire in Firefox & Chrome without this

      e.dataTransfer.dropEffect = 'copy';
    }

    onDragLeave(e) { // leaving target element
      // console.log('enter', e.target);

      if (!this.currentDropElement) return;

      var box = this.currentDropElement.getBoundingClientRect();

      if ((e.y < box.top) || (e.y > box.bottom) || (e.x < box.left) || (e.x > box.right)) {
        // console.log('leaving drop');

        this.currentDropElement.classList.remove('dragOver');

        this.currentDropElement = null;
      }
    }

    onDrop(e) {
      e.preventDefault();

      var files = e.dataTransfer.files;
      var items = e.dataTransfer.items;
      var dropElement = this.getDropElement(e.target);

      if(files.length > 0) {
        Carbon.Reactive.trigger('drop', {
          files   : files,
          items   : items,
          element : dropElement
        });
      }

      if (dropElement) {
        $(dropElement).triggerHandler({
          type  : 'dropped',
          items : items,
          files : files
        });

        dropElement.classList.remove('dragOver');
      }
    }

    getDropElement(target) {
      if (target.getAttribute('on-drop') || target.getAttribute('carbon-drop')) return target;

      // Look upto 5 level up
      for (var i = 0; i < 5; i++) {
        target = target.parentElement;

        if (!target) return null;

        if (target.getAttribute('on-drop') || target.getAttribute('carbon-drop')) return target;
      }

      return null;
    }
  }

  export class FileDrop {
    element: any;
    options: any;

    reactive = new Carbon.Reactive();

  	constructor(element, options = { }) {
  		this.element = $(element);
      this.options = options;

      if (this.element.hasClass('setup')) return;

      this.element.addClass('setup');

      if (!this.element.attr('on-drop')) {
        this.element.attr('on-drop', 'pass');
      }

      // dropped to not conflict with drop
      this.element.on('dropped', this.onDropped.bind(this));
  	}

    subscribe(callback) {
      return this.reactive.subscribe(callback);
    }

    clear() { }

    setAccept(formats) {
      this.options.accept = formats;
    }

  	onDropped(e) {
      this.reactive.trigger(e.files);
  	}
  }

  export class FileInput {
    element: any;
    reactive = new Carbon.Reactive();

    constructor(element, options) {
      this.element = $(element);

      if (this.element.length == 0) throw new Error('File input element not found');

      this.element[0].addEventListener('change', this.onChange.bind(this), false);

      if (options && options.accept) {
        this.element.attr('accept', options.accept)
      }

      if (options && options.multiple) {
        this.element.attr('multiple', 'true');
      }
    }

    subscribe(callback) {
      return this.reactive.subscribe(callback);
    }

    clear() {
      var ua = navigator.userAgent;

      // Clear the file input in all browsers except IE
      if (ua && ua.indexOf('MSIE') === -1) {
        this.element.val('');
      }
    }

    setAccept(formats) {
      this.element.attr('accept', formats.map(f => '.' + f).join(','));
    }

    onChange(e) {
      var files = this.element[0].files;

      if (files.length == 0) return;

      this.reactive.trigger(files);
    }
  }

  export class FilePreview {
    file: any;
    image: Image;
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

      var URL = window.URL && window.URL.createObjectURL ? window.URL :
        window.webkitURL && window.webkitURL.createObjectURL ? window.webkitURL : null;

      return URL.createObjectURL(this.file);
    }

    load() {
      // TODO: Subsample images in iOS

      var defer = new $.Deferred();

      if(this.loaded) {
        defer.resolve(this.image);

        return defer;
      }

      // TODO: Ensure we we do not read while uploading

      var reader = new FileReader();

      reader.onloadend = () => {
        this.image.src = reader.result;

        this.image.onload = () => {
          this.loaded = true;

          defer.resolve(this.image);
        }

        this.image.onerror = () => {
          defer.reject();
        }
      };

      reader.onerror = () => {
        defer.reject();
      }

      reader.readAsDataURL(this.file);

      return defer;
    }

    resize(maxWidth: number, maxHeight: number) {
      // TODO: Apply EXIF rotation

      var defer = new $.Deferred();

      this.load().then(image => {
        var size = Util.fitIn(image.width, image.height, maxWidth, maxHeight);

        var canvas = document.createElement('canvas');

        canvas.width = size.width;
        canvas.height = size.height;

        var ctx = canvas.getContext("2d");

        ctx.drawImage(image, 0, 0, size.width, size.height);

        var data = canvas.toDataURL('image/png');

        defer.resolve({
          width  : size.width,
          height : size.height,
          data   : data,
          url    : data
        });
      });

      return defer;
    }
  }

  var Util = {
    fitIn(width, height, maxWidth, maxHeight) {
    	if (height <= maxHeight && width <= maxWidth) {
    		return { width: width, height: height }
    	}

   		var mutiplier = (maxWidth / width);

   		if (height * mutiplier <= maxHeight) {
  		  return {
    		  width: maxWidth,
    		  height: Math.round(height * mutiplier)
  		  }
     	}
  		else {
      	var mutiplier = (maxHeight / height);

       	return {
    		  width: Math.round(width * mutiplier),
    		  height:  maxHeight
  		  }
  		}
    }
  }

  var FileUtil = {
    scales: ['B', 'KB', 'MB', 'GB'],

    getFormatFromName(name) {
      var split = name.split('.');

      return split[split.length - 1];
    },

    threeNonZeroDigits(value) {
      if (value >= 100) return parseInt(value, 10);

      if (value >= 10) {
        return Math.round(value * 10) / 10;
      }
      else {
        return Math.round(value * 100) / 100;
      }
    },

    formatBytes(byteCount: number) {
      var i = 0;
      var base = 1000;
      var value = byteCount;

      while ((base - 1) < value) {
        value /= base;
        i++;
      }

      return FileUtil.threeNonZeroDigits(value) + " " + FileUtil.scales[i];
    }
  };
  // TODO: remove this
  window.FileUtil = FileUtil;

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
    _progress: Progress = new Progress(0, 100);
    defer: any;
    response: UploadResponse;

    reactive = new Carbon.Reactive();

    constructor(url) {
      this.url = url;
      this.status = 0;

      var format = this.url.substring(this.url.lastIndexOf('.') + 1);

      this.type = fileFormats[format] + '/' + format;

      this.defer = new $.Deferred();

      this.defer.promise(this);

      // TODO, add id & open up web socket to monitor progress
    }

    onProgress(e) {
      this._progress.loaded = e.loaded;

      this.defer.notify(this._progress);

      if (e.loaded < 100) {
        setTimeout(() => {
          this.onProgress({ loaded: e.loaded + 1 });
        }, 10);
      }
    }

    on(name, callback) {
      this.reactive.on(name, callback);
    }

    start() {
      var ajax = $.post('https://uploads.carbonmade.com/', { url: this.url });

      ajax.then(this.onDone.bind(this));

      this.onProgress({ loaded: this._progress.loaded + 1 });

      this.reactive.trigger({ type : 'started' });

      return this.defer;
    }

    onDone(data: UploadResponse) {
      this.status = UploadStatus.Completed;
      this.response = data;

      this.defer.resolve(data);
    }
  }
}
