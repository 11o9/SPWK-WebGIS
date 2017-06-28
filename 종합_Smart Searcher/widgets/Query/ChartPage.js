define(['dojo/_base/declare',
'dojo/_base/html',
'dojo/dom'
],
function(declare,html,dom) {
  return declare(null, {
    constructor: function(parcelArea){
    this.parcelArea = parcelArea;
    this.convert();
  },
  convert : function(){
  var newWindow = window.open('widgets/Query/ChartPage.html');
  newWindow.document.open('widgets/Query/ChartPage.html');
  console.log(newWindow);



  }
  });
});