var fs = require('fs');
var xml2js = require('xml2js');

var parser = new xml2js.Parser();

fs.readFile(__dirname + '/input.xml', 'utf8', function(err, data) {
  parser.parseString(data, function(err, result) {
    if(err) {
      return console.log(err);
    }
    json = JSON.stringify(result);
    fs.writeFile(__dirname + '/output.json', json, function(err) {
      if(err) {
        return console.log(err);
      }
    })
  })
});
