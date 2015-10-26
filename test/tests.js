test("Test Defaults", function() {
  var manager = new UploadManager({
    url: 'http://uploads.carbonmade.net',
    uploadLimit: 10
  });

  ok(0 == manager.uploads.length, "OK" );
  ok(0 == manager.queue.length, "OK" );
});

test( "Test Options", function() {
  var manager = new UploadManager({
    url: 'http://uploads.carbonmade.net',
    uploadLimit: 10
  });

  ok('http://uploads.carbonmade.net' == manager.options.url, "OK" );
  ok(10 == manager.uploadLimit, "OK" );
});

test("Triggers", function() {
  var manager = new UploadManager({
    url: 'http://uploads.carbonmade.net',
    uploadLimit: 10
  });

  var startedTriggered = false;

  manager.on('started', function() {
    startedTriggered = true;
  });

  manager.start();

  ok(startedTriggered, "OK" );
});



QUnit.begin(function(e) {
  console.log('begin');

  console.log(e);

});

QUnit.moduleDone(function(e) {

   console.log(e);
});

/*

QUnit.log(function(details) {
  var response;

  // Ignore passing assertions
  if (details.result) {
    return;
  }

  response = details.message || '';

  if (typeof details.expected !== 'undefined') {
    if (response) {
      response += ', ';
    }

    response += 'expected: ' + details.expected + ', but was: ' + details.actual;
  }

  if (details.source) {
    response += "\n" + details.source;
  }

  console.log(response);
});
*/

QUnit.testDone(function(e) {

  // duration
  // failed
  // passed
  // total
  // name

  // console.log(e);

  try {
    add(e);
  }
  catch(error) { }
});


function add(e) {
  var data = jQuery.param({

    frontend: 'uploader',
    name: e.name,
    duration: e.duration,
    passed: e.passed,
    total: e.total
  });


  var url = 'http://platform.carbonmade.net/tests/create?' + data;

  console.log(url);
  // console.log(url);

  var el = $('<script/>', { src: url });

  el.appendTo('body');
}
