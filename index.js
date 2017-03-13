var fs = require('fs');
var parseString = require('xml2js').parseString;
var DOMParser = require('xmldom').DOMParser;

fs.readFile(__dirname + '/input.xml', 'utf8', function(err, data) {
  var xmlStringSerialized = new DOMParser().parseFromString(data, 'text/xml');
  parseString(xmlStringSerialized, function(err, result) {
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
