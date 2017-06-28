///////////////////////////////////////////////////////////////////////////
// Copyright © 2014 - 2016 Esri. All Rights Reserved.
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
///////////////////////////////////////////////////////////////////////////

define([
  'dojo/on',
  'dojo/query',
  'dojo/Deferred',
  'dojo/_base/lang',
  'dojo/_base/html',
  'dojo/_base/array',
  'dojo/promise/all',
  'dojo/_base/declare',
  'dijit/_WidgetsInTemplateMixin',
  'jimu/BaseWidget',
  'jimu/dijit/Message',
  'jimu/utils',
  'jimu/MapManager',
  'jimu/filterUtils',
  'esri/layers/FeatureLayer',
  'esri/dijit/PopupTemplate',
  'esri/renderers/SimpleRenderer',
  'esri/symbols/jsonUtils',
  'esri/lang',
  'esri/request',
  './TaskSetting',
  './SingleQueryLoader',
  './SingleQueryResult',
  './ChartPage',
  './utils',
  'jimu/LayerInfos/LayerInfos',
  'jimu/dijit/LoadingShelter',
  'dijit/form/Select'
],
  function (on, query, Deferred, lang, html, array, all, declare, _WidgetsInTemplateMixin, BaseWidget,
    Message, jimuUtils, MapManager, FilterUtils, FeatureLayer, PopupTemplate, SimpleRenderer, symbolJsonUtils,
    esriLang, esriRequest, TaskSetting, SingleQueryLoader, SingleQueryResult,ChartPage, queryUtils, LayerInfos) {

    return declare([BaseWidget, _WidgetsInTemplateMixin], {
      name: 'Query',
      baseClass: 'jimu-widget-query',
      currentTaskSetting: null,
      hiddenClass: "not-visible",
      _resultLayerInfos: null,//[{value,label,taskIndex,singleQueryResult}]
      mapManager: null,
      layerInfosObj: null,
      labelTasks: '',
      labelResults: '',
      parcelAreaBareNum: "",


      /*
      test:
      http://map.floridadisaster.org/GIS/rest/services/Events/FL511_Feeds/MapServer/4
      http://maps.usu.edu/ArcGIS/rest/services/MudLake/MudLakeMonitoringSites/MapServer/0
      http://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/0
      1. if queryType is 1, it means that the query supports OrderBy and Pagination.
         such as: http://services2.arcgis.com/K1Xet5rYYN1SOWtq/ArcGIS/rest/services/
         USA_hostingFS/FeatureServer/0
      2. if queryType is 2, it means that the query supports objectIds, but
         doesn't support OrderBy or Pagination.
         such as: http://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer
      3. if queryType is 3, it means that the query doesn't support objectIds.
      */

      postMixInProperties: function () {
        this.inherited(arguments);
        this._resultLayerInfos = [];
        var strClearResults = this.nls.clearResults;
        var tip = esriLang.substitute({ clearResults: strClearResults }, this.nls.operationalTip);
        this.nls.operationalTip = tip;
        this.labelTasks = this.nls.tasks;
        this.labelResults = this.nls.queryResults;
        if (this.config) {
          this.config = queryUtils.getConfigWithValidDataSource(this.config);
          this._updateConfig();
          if (this.config.labelTasks) {
            this.labelTasks = this.config.labelTasks;
          }
          if (this.config.labelResults) {
            this.labelResults = this.config.labelResults;
          }
        }
        this.mapManager = MapManager.getInstance();
        this.layerInfosObj = LayerInfos.getInstanceSync();
      },

      _updateConfig: function () {
        if (this.config && this.config.queries && this.config.queries.length > 0) {
          array.forEach(this.config.queries, lang.hitch(this, function (singleConfig) {
            this._rebuildFilter(singleConfig.url, singleConfig.filter);
          }));
        }
      },

      _rebuildFilter: function (url, filter) {
        try {
          if (filter) {
            delete filter.expr;
            var filterUtils = new FilterUtils();
            filterUtils.isHosted = jimuUtils.isHostedService(url);
            filterUtils.getExprByFilterObj(filter);
          }
        } catch (e) {
          console.log(e);
        }
      },

      postCreate: function () {
        this.inherited(arguments);
        this._initSelf();
        this._updateResultDetailUI();
        var trs = query('.single-task', this.tasksTbody);
        if (trs.length === 1) {
          html.addClass(this.domNode, 'only-one-task');
          this._showTaskSettingPane();
          this._onClickTaskTr(trs[0]);
        }
      },

      onOpen: function () {
        var info = this._getCurrentResultLayerInfo();
        var singleQueryResult = info && info.singleQueryResult;
        if (singleQueryResult) {
          singleQueryResult.showLayer();
        }
        this._showTempLayers();
        this.inherited(arguments);
      },

      onActive: function () {
        //this.map.setInfoWindowOnClick(false);
        // this.mapManager.disableWebMapPopup();
        this._showTempLayers();
      },

      onDeActive: function () {
        //deactivate method of DrawBox dijit will call this.map.setInfoWindowOnClick(true) inside
        // this.drawBox.deactivate();
        if (this.currentTaskSetting) {
          this.currentTaskSetting.deactivate();
        }
        this.mapManager.enableWebMapPopup();
        this._hideTempLayers();
      },

      onClose: function () {
        if (this.config.hideLayersAfterWidgetClosed) {
          this._hideAllLayers();
        }
        this._hideInfoWindow();
        this._hideTempLayers();
        this.inherited(arguments);
      },

      destroy: function () {
        this._hideInfoWindow();
        this._removeResultLayerInfos(this._resultLayerInfos);
        this.inherited(arguments);
      },

      _hideTempLayers: function () {
        if (this.currentTaskSetting) {
          this.currentTaskSetting.hideTempLayers();
        }
      },

      _showTempLayers: function () {
        if (this.currentTaskSetting) {
          this.currentTaskSetting.showTempLayers();
        }
      },

      _initSelf: function () {
        var queries = this.config.queries;
        if (queries.length === 0) {
          html.setStyle(this.tasksNode, 'display', 'none');
          html.setStyle(this.noQueryTipSection, 'display', 'block');
          return;
        }

        //create query tasks
        array.forEach(queries, lang.hitch(this, function (singleConfig, index) {
          var name = singleConfig.name;
          var strTr = '<tr class="single-task">' +
            '<td class="first-td"><img class="task-icon" /></td>' +
            '<td class="second-td">' +
            '<div class="list-item-name task-name-div"></div>' +
            '</td>' +
            '</tr>';
          var tr = html.toDom(strTr);

          var queryNameDiv = query(".task-name-div", tr)[0];
          queryNameDiv.innerHTML = name;
          html.place(tr, this.tasksTbody);
          var img = query("img", tr)[0];
          if (singleConfig.icon) {
            img.src = jimuUtils.processUrlInWidgetConfig(singleConfig.icon, this.folderUrl);
          } else {
            img.src = this.folderUrl + "css/images/default_task_icon.png";
          }
          tr.taskIndex = index;
          tr.singleConfig = singleConfig;
          if (index % 2 === 0) {
            html.addClass(tr, 'even');
          } else {
            html.addClass(tr, 'odd');
          }
        }));

      },

      _onTabHeaderClicked: function (event) {
        var target = event.target || event.srcElement;
        if (target === this.taskQueryItem) {
          var currentResultLayerInfo = this._getCurrentResultLayerInfo();
          if (currentResultLayerInfo) {
            var singleQueryResult = currentResultLayerInfo.singleQueryResult;
            if (singleQueryResult) {
              if (singleQueryResult.singleRelatedRecordsResult || singleQueryResult.multipleRelatedRecordsResult) {
                singleQueryResult._showFeaturesResultDiv();
              }
            }
          }
          this._switchToTaskTab();
        } else if (target === this.resultQueryItem) {
          this._switchToResultTab();
        }

      },

      _switchToTaskTab: function () {
        html.removeClass(this.resultQueryItem, 'selected');
        html.removeClass(this.resultTabView, 'selected');
        html.addClass(this.taskQueryItem, 'selected');
        html.addClass(this.taskTabView, 'selected');
      },

      _switchToResultTab: function () {
        this._updateResultDetailUI();
        html.removeClass(this.taskQueryItem, 'selected');
        html.removeClass(this.taskTabView, 'selected');
        html.addClass(this.resultQueryItem, 'selected');
        html.addClass(this.resultTabView, 'selected');
      },

      _updateResultDetailUI: function () {
        if (this._resultLayerInfos.length > 0) {
          html.removeClass(this.resultSection, this.hiddenClass);
          html.addClass(this.noresultSection, this.hiddenClass);
        } else {
          html.addClass(this.resultSection, this.hiddenClass);
          html.removeClass(this.noresultSection, this.hiddenClass);
        }
      },

      _showTaskListPane: function () {
        this._switchToTaskTab();
        html.setStyle(this.taskList, 'display', 'block');
        html.setStyle(this.taskSettingContainer, 'display', 'none');
      },

      _showTaskSettingPane: function () {
        this._switchToTaskTab();
        html.setStyle(this.taskList, 'display', 'none');
        html.setStyle(this.taskSettingContainer, 'display', 'block');
      },
      //print report btn
      _onPrintReportClicked:function(){
        window.open('widgets/Query/ChartPage.html');
      },
      _onPrintParcelInfoClicked: function(){
        var currentSelectedState = sessionStorage.getItem('searchAreaName');
        var GID = localStorage.getItem('GID');
        
      },
      /*------------------------------task list------------------------------------*/

      _onTaskListClicked: function (event) {
        var target = event.target || event.srcElement;
        var tr = jimuUtils.getAncestorDom(target, lang.hitch(this, function (dom) {
          return html.hasClass(dom, 'single-task');
        }), 10);

        if (!tr) {
          return;
        }

        this._onClickTaskTr(tr);
      },

      _onClickTaskTr: function (tr) {
        //this._getLayerInfoAndServiceInfo(tr).then(lang.hitch(this, function(response){
        this._getLayerInfoAndRelationshipLayerInfos(tr).then(lang.hitch(this, function (response) {
          var layerInfo = response.layerInfo;

          localStorage.setItem('searchAreaName', layerInfo.name.split("_")[0]);
          console.log(localStorage.getItem('searchAreaName').split("_")[0]);

          //var serviceInfo = response.serviceInfo;
          var relationshipLayerInfos = response.relationshipLayerInfos;
          var relationshipPopupTemplates = response.relationshipPopupTemplates;
          tr.singleConfig.objectIdField = jimuUtils.getObjectIdField(layerInfo);
          var popupInfo = this._getPopupInfo(layerInfo, tr.singleConfig);
          if (!popupInfo) {
            console.error("can't get popupInfo");
          }
          popupInfo.fieldInfos = queryUtils.getPortalFieldInfosWithoutShape(layerInfo, popupInfo.fieldInfos);
          delete popupInfo.readFromWebMap;
          //we prepare currentAttrs here
          var currentAttrs = SingleQueryLoader.getCleanCurrentAttrsTemplate();
          currentAttrs.queryTr = tr;
          currentAttrs.config = lang.clone(tr.singleConfig);
          currentAttrs.config.popupInfo = popupInfo; //add popupInfo attribute
          currentAttrs.layerInfo = layerInfo;
          //currentAttrs.serviceInfo = serviceInfo;
          currentAttrs.relationshipLayerInfos = relationshipLayerInfos;
          currentAttrs.relationshipPopupTemplates = relationshipPopupTemplates;
          currentAttrs.query.maxRecordCount = layerInfo.maxRecordCount || 1000;

          currentAttrs.queryType = queryUtils.getQueryType(layerInfo);

          //after get currentAttrs, we can show task setting pane destroy the old TaskSetting dijit and create a new one
          if (this.currentTaskSetting) {
            this.currentTaskSetting.destroy();
          }
          this.currentTaskSetting = null;
          this._showTaskSettingPane();
          this.currentTaskSetting = new TaskSetting({
            nls: this.nls,
            map: this.map,
            currentAttrs: currentAttrs,
            layerInfosObj: this.layerInfosObj,
            onBack: lang.hitch(this, function () {
              this._showTaskListPane();
            }),
            onApply: lang.hitch(this, function (currentAttrs) {
              this._onBtnApplyClicked(currentAttrs);
            })
          });

          if (this.currentTaskSetting.canAutoRunning()) {
            this._switchToResultTab();
            //if the task can run without specify other parameters, then we run it automatically
            this.currentTaskSetting.run();
          }

          this.currentTaskSetting.placeAt(this.taskSettingContainer);
        }), lang.hitch(this, function (err) {
          console.error("can't get layerInfo", err);
        }));
      },




      _getLayerInfoAndServiceInfo: function (tr) {
        var def = new Deferred();
        var layerDef = this._getLayerInfo(tr);
        var serviceDef = this._getServiceInfo(tr);
        this.shelter.show();
        all([layerDef, serviceDef]).then(lang.hitch(this, function (results) {
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          tr.layerInfo = results[0];
          tr.serviceInfo = results[1];
          def.resolve({
            layerInfo: tr.layerInfo,
            serviceInfo: tr.serviceInfo
          });
        }), lang.hitch(this, function (err) {
          console.error(err);
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          var errMsg = "";
          if (err && err.httpCode === 403) {
            errMsg = this.nls.noPermissionsMsg;
          }
          this._showQueryErrorMsg(errMsg);
          def.reject();
        }));
        return def;
      },

      _getLayerInfoAndRelationshipLayerInfos: function (tr) {
        var def = new Deferred();
        this.shelter.show();
        var layerDef = this._getLayerInfo(tr);
        layerDef.then(lang.hitch(this, function (layerInfo) {
          tr.layerInfo = layerInfo;
          this._getRelationshipLayerInfos(tr).then(lang.hitch(this, function (relationshipLayerInfos) {
            if (!this.domNode) {
              return;
            }

            tr.relationshipLayerInfos = relationshipLayerInfos;
            var relationshipPopupTemplates = {};
            var webMapItemData = this.map.itemInfo.itemData;

            var baseServiceUrl = tr.singleConfig.url.replace(/\d*\/*$/g, '');

            for (var layerId in relationshipLayerInfos) {
              var layerDefinition = relationshipLayerInfos[layerId];
              //var popupInfo = queryUtils.getDefaultPopupInfo(layerDefinition, false, true);
              var layerUrl = baseServiceUrl + layerId;
              var popupInfo = queryUtils.getPopupInfoForRelatedLayer(webMapItemData, layerUrl, layerDefinition);
              relationshipPopupTemplates[layerId] = new PopupTemplate(popupInfo);
            }
            this.shelter.hide();
            def.resolve({
              layerInfo: layerInfo,
              relationshipLayerInfos: relationshipLayerInfos,
              relationshipPopupTemplates: relationshipPopupTemplates
            });
          }), lang.hitch(this, function (err) {
            if (!this.domNode) {
              return;
            }
            this.shelter.hide();
            def.reject(err);
          }));
        }), lang.hitch(this, function (err) {
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          def.reject(err);
        }));
        return def;
      },

      _getLayerInfo: function (tr) {
        var def = new Deferred();
        if (tr.layerInfo) {
          def.resolve(tr.layerInfo);
        } else {
          var layerUrl = tr.singleConfig.url;
          esriRequest({
            url: layerUrl,
            content: {
              f: 'json'
            },
            handleAs: 'json',
            callbackParamName: 'callback'
          }).then(lang.hitch(this, function (layerInfo) {
            tr.layerInfo = layerInfo;
            def.resolve(layerInfo);
          }), lang.hitch(this, function (err) {
            def.reject(err);
          }));
        }
        return def;
      },

      _getServiceInfo: function (tr) {
        var def = new Deferred();
        if (tr.serviceInfo) {
          def.resolve(tr.serviceInfo);
        } else {
          var layerUrl = tr.singleConfig.url;
          var serviceUrl = this._getServiceUrlByLayerUrl(layerUrl);
          esriRequest({
            url: serviceUrl,
            content: {
              f: 'json'
            },
            handleAs: 'json',
            callbackParamName: 'callback'
          }).then(lang.hitch(this, function (serviceInfo) {
            tr.serviceInfo = serviceInfo;
            def.resolve(serviceInfo);
          }), lang.hitch(this, function (err) {
            def.reject(err);
          }));
        }
        return def;
      },

      _getRelationshipLayerInfos: function (tr) {
        var def = new Deferred();
        if (tr.relationshipLayerInfos) {
          def.resolve(tr.relationshipLayerInfos);
        } else {
          var layerInfo = tr.layerInfo;
          var relationships = layerInfo.relationships;
          if (relationships && relationships.length > 0) {
            var layerUrl = tr.singleConfig.url;
            var serviceUrl = this._getServiceUrlByLayerUrl(layerUrl);
            var defs = array.map(relationships, lang.hitch(this, function (relationship) {
              var url = serviceUrl + "/" + relationship.relatedTableId;
              return esriRequest({
                url: url,
                content: {
                  f: 'json'
                },
                handleAs: 'json',
                callbackParamName: 'callback'
              });
            }));
            all(defs).then(lang.hitch(this, function (results) {
              tr.relationshipLayerInfos = {};
              array.forEach(relationships, lang.hitch(this, function (relationship, index) {
                tr.relationshipLayerInfos[relationship.relatedTableId] = results[index];
              }));
              def.resolve(tr.relationshipLayerInfos);
            }), lang.hitch(this, function (err) {
              tr.relationshipLayerInfos = null;
              def.reject(err);
            }));
          } else {
            tr.relationshipLayerInfos = {};
            def.resolve(tr.relationshipLayerInfos);
          }
        }
        return def;
      },

      _getServiceUrlByLayerUrl: function (layerUrl) {
        var lastIndex = layerUrl.lastIndexOf("/");
        var serviceUrl = layerUrl.slice(0, lastIndex);
        return serviceUrl;
      },

      _getPopupInfo: function (layerDefinition, config) {
        var result = null;
        var defaultPopupInfo = queryUtils.getDefaultPopupInfo(layerDefinition, false, false);
        result = defaultPopupInfo;
        var popupInfo = null;
        if (config.popupInfo) {
          //new query
          if (config.popupInfo.readFromWebMap) {
            if (config.webMapLayerId) {
              var layerInfo = null;
              if (queryUtils.isTable(layerDefinition)) {
                layerInfo = this.layerInfosObj.getTableInfoById(config.webMapLayerId);
              } else {
                layerInfo = this.layerInfosObj.getLayerInfoById(config.webMapLayerId);
              }
              if (layerInfo) {
                popupInfo = layerInfo.getPopupInfo();
                if (popupInfo) {
                  popupInfo = lang.clone(popupInfo);
                  result = popupInfo;
                } else {
                  result = defaultPopupInfo;
                }
              } else {
                result = defaultPopupInfo;
              }
            } else {
              result = defaultPopupInfo;
            }
          } else {
            popupInfo = lang.clone(config.popupInfo);
            delete popupInfo.readFromWebMap;
            result = popupInfo;
          }
        } else if (config.popup) {
          //old query, update old config.popup to new config.popupInfo
          result = queryUtils.upgradePopupToPopupInfo(layerDefinition, config.popup);
        } else {
          result = defaultPopupInfo;
        }

        if (!result) {
          result = defaultPopupInfo;
        }

        //before we return popupInfo, we should remove unsupported field names, such as: "relationships/0/OBJECTID"
        queryUtils.removePopupInfoUnsupportFields(layerDefinition, result);
        return result;
      },

      /*------------------------------task list------------------------------------*/
      //-------------------------------Part 1----------------------------------------------//
      CreateQuerySearchTable: function (where) {
        var currentSelectedState = localStorage.getItem('searchAreaName');
       // console.log(currentSelectedState);
       // console.log(currentSelectedState == "서울");
       // console.log(where.split(" AND "));
        var attrCity, attrDistrict, attrArea, attrDeterioration, attrPriceFrom, attrPriceTo, attrFARFrom, attrFARTo, attrGovOwned;
        var attrIncluded = [];
        var attrExcluded = [];
        var whereSplit = where.split(" AND ");
        if (currentSelectedState == "경기도") {
          if (new RegExp("[군]").test(where)) {
            if (new RegExp("[치]").test(where)) {
              attrCity = whereSplit[0].split("'")[1];
              attrDistrict = whereSplit[1].split("'")[1];
              attrArea = whereSplit[2].split(" < ")[1].replace(")", "");
              attrDeterioration = whereSplit[3].split(" >= ")[1].replace(")", "");
              attrPriceFrom = whereSplit[4].split(" ")[2];
              attrPriceTo = whereSplit[5].replace(")", "");
              attrFARFrom = whereSplit[6].split(" ")[2];
              attrFARTo = whereSplit[7].replace(")", "");
              attrGovOwned = whereSplit[8].split(" >= ")[1].replace(")", "");
              if (whereSplit.length >= 12) {
                for (var i = 10; i < whereSplit.length; i++) {
                  if (new RegExp("\\bNOT\\b").test(whereSplit[i]))
                    attrExcluded.push(whereSplit[i].split("%")[1]);
                  else
                    attrIncluded.push(whereSplit[i].split("%")[1]);
                }
              }
              //included & excluded
            } else {
              attrCity = whereSplit[0].split("'")[1];
              attrArea = whereSplit[1].split(" < ")[1].replace(")", "");
              attrDeterioration = whereSplit[2].split(" >= ")[1].replace(")", "");
              attrPriceFrom = whereSplit[3].split(" ")[2];
              attrPriceTo = whereSplit[4].replace(")", "");
              attrFARFrom = whereSplit[5].split(" ")[2];
              attrFARTo = whereSplit[6].replace(")", "");
              attrGovOwned = whereSplit[7].split(" >= ")[1].replace(")", "");
              if (whereSplit.length >= 11) {
                for (var i = 9; i < whereSplit.length; i++) {
                  if (new RegExp("\\bNOT\\b").test(whereSplit[i]))
                    attrExcluded.push(whereSplit[i].split("%")[1]);
                  else
                    attrIncluded.push(whereSplit[i].split("%")[1]);
                }
              }
            }
          } else {
            attrArea = whereSplit[0].split(" < ")[1].replace(")", "");
            attrDeterioration = whereSplit[1].split(" >= ")[1].replace(")", "");
            attrPriceFrom = whereSplit[2].split(" ")[2];
            attrPriceTo = whereSplit[3].replace(")", "");
            attrFARFrom = whereSplit[4].split(" ")[2];
            attrFARTo = whereSplit[5].replace(")", "");
            attrGovOwned = whereSplit[6].split(" >= ")[1].replace(")", "");
            if (whereSplit.length >= 10) {
              for (var i = 8; i < whereSplit.length; i++) {
                if (new RegExp("\\bNOT\\b").test(whereSplit[i]))
                  attrExcluded.push(whereSplit[i].split("%")[1]);
                else
                  attrIncluded.push(whereSplit[i].split("%")[1]);
              }
            }
          }
        }
        console.log(currentSelectedState == "서울" || currentSelectedState == "부산");
        if (currentSelectedState == "서울" || currentSelectedState == "부산") {
          if (new RegExp("[치]").test(where)) {
            attrCity = whereSplit[0].split("'")[1];
            attrArea = whereSplit[1].split(" < ")[1].replace(")", "");
            attrDeterioration = whereSplit[2].split(" >= ")[1].replace(")", "");
            attrPriceFrom = whereSplit[3].split(" ")[2];
            attrPriceTo = whereSplit[4].replace(")", "");
            attrFARFrom = whereSplit[5].split(" ")[2];
            attrFARTo = whereSplit[6].replace(")", "");
            if (whereSplit.length >= 10) {
              for (var i = 8; i < whereSplit.length; i++) {
                if (new RegExp("\\bNOT\\b").test(whereSplit[i]))
                  attrExcluded.push(whereSplit[i].split("%")[1]);
                else
                  attrIncluded.push(whereSplit[i].split("%")[1]);
              }
            }
          } else {
          attrArea = whereSplit[0].split(" < ")[1].replace(")", "");
          attrDeterioration = whereSplit[1].split(" >= ")[1].replace(")", "");
          attrPriceFrom = whereSplit[2].split(" ")[2];
          attrPriceTo = whereSplit[3].replace(")", "");
          attrFARFrom = whereSplit[4].split(" ")[2];
          attrFARTo = whereSplit[5].replace(")", "");
          if (whereSplit.length >= 9) {
            for (var i = 7; i < whereSplit.length; i++) {
              if (new RegExp("\\bNOT\\b").test(whereSplit[i]))
                attrExcluded.push(whereSplit[i].split("%")[1]);
              else
                attrIncluded.push(whereSplit[i].split("%")[1]);
            }
          }
          }
        }

        // sessionStorage.setItem('attrDong',attrDong);
        // sessionStorage.setItem('attrArea',attrArea);
        // sessionStorage.setItem('attrDeterioration',attrDeterioration);
        // sessionStorage.setItem('attrPriceFrom',attrPriceFrom);
        // sessionStorage.setItem('attrPriceTo',attrPriceTo);
        // sessionStorage.setItem('attrFARFrom',attrFARFrom);
        // sessionStorage.setItem('attrFARTo',attrFARTo);
        // sessionStorage.setItem('attrSingleHousehold',attrSingleHousehold);
        // sessionStorage.setItem('attrApartment',attrApartment);
        // sessionStorage.setItem('attrTownHouse',attrTownHouse);
        // sessionStorage.setItem('attrMultiHousehold',attrMultiHousehold);
        var finalAttrs = [];
        finalAttrs.push("city/"+attrCity);
        finalAttrs.push("district/"+attrDistrict);
        finalAttrs.push("area/"+attrArea);
        finalAttrs.push("deterioration/"+attrDeterioration);
        finalAttrs.push("priceFrom/"+attrPriceFrom);
        finalAttrs.push("priceTo/"+attrPriceTo);
        finalAttrs.push("FARFrom/"+attrFARFrom);
        finalAttrs.push("FARTo/"+attrFARTo);
        finalAttrs.push("govOwned/"+attrGovOwned);
        finalAttrs.push("included/"+String(attrIncluded).replace(",","|"));
        finalAttrs.push("excluded/"+String(attrExcluded).replace(",","|"));

        for(var i =0;i<finalAttrs.length;i++){
          if(finalAttrs[i].split("/")[1]=="undefined"|| finalAttrs[i].split("/")[1]=="" || finalAttrs[i].split("/")[1]=="0"){
            finalAttrs[i] = "Don't Show";
          }
        }

        // console.log(finalAttrs);
        // console.log(attrCity);
        // console.log(attrDistrict);
        // console.log(attrArea);
        // console.log(attrDeterioration);
        // console.log(attrPriceFrom);
        // console.log(attrPriceTo);
        // console.log(attrFARFrom);
        // console.log(attrFARTo);
        // console.log(attrGovOwned);
        // console.log(attrIncluded);
        // console.log(attrExcluded);



        sessionStorage.setItem('part1SearchAttrs',finalAttrs);
      },

      //start to query
      _onBtnApplyClicked: function (currentAttrs) {
        //we should enable web map popup here
        this.mapManager.enableWebMapPopup();

        html.addClass(this.resultTabView, this.hiddenClass);

        //set query.resultLayer
        var singleResultLayer = currentAttrs.config.singleResultLayer;
        if (singleResultLayer) {
          var taskIndex = currentAttrs.queryTr.taskIndex;
          var taskOptions = this._getResultLayerInfosByTaskIndex(taskIndex);
          if (taskOptions.length > 0) {
            //When SingleQueryResult is destroyed, the releated feature layer is removed
            this._removeResultLayerInfos(taskOptions);
          }
        }

        console.log(currentAttrs.query);
        var queryName = this._getBestQueryName(currentAttrs.config.name || '');

        this.CreateQuerySearchTable(currentAttrs.query.where);

        this._createNewResultLayer(currentAttrs, queryName);

        this.shelter.show();

        var singleQueryResult = new SingleQueryResult({
          map: this.map,
          nls: this.nls,
          label: queryName,
          currentAttrs: currentAttrs,
          queryWidget: this,
          onBack: lang.hitch(this, function () {
            this._switchToResultTab();
          })
        });
        this.own(on(singleQueryResult, 'show-related-records', lang.hitch(this, this._onShowRelatedRecords)));
        this.own(on(singleQueryResult, 'hide-related-records', lang.hitch(this, this._onHideRelatedRecords)));
        //we should put singleQueryResult into the dom tree when _onSingleQueryFinished is called
        //singleQueryResult.placeAt(this.singleResultDetails);

        singleQueryResult.executeQueryForFirstTime().then(lang.hitch(this, function (/*allCount*/) {
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          html.removeClass(this.resultTabView, this.hiddenClass);
          // if(allCount > 0){
          //   this._onSingleQueryFinished(singleQueryResult, queryName);
          // }
          this._onSingleQueryFinished(singleQueryResult, queryName);
          this._updateResultDetailUI();
        }), lang.hitch(this, function (err) {
          console.error(err);
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          html.removeClass(this.resultTabView, this.hiddenClass);
        }));
      },

      _getBestQueryName: function (queryName) {
        if (queryName) {
          queryName += " _" + this.nls.queryResult;
        }
        else {
          queryName += this.nls.queryResult;
        }
        var finalName = queryName;
        var allNames = array.map(this.map.graphicsLayerIds, lang.hitch(this, function (glId) {
          var layer = this.map.getLayer(glId);
          return layer.name;
        }));
        var flag = 2;
        while (array.indexOf(allNames, finalName) >= 0) {
          finalName = queryName + '_' + flag;
          flag++;
        }
        return finalName;
      },

      //create a FeatureLayer
      _createNewResultLayer: function (currentAttrs, queryName) {
        var resultLayer = null;
        var renderer = null;
        var taskIndex = currentAttrs.queryTr.taskIndex;

        var layerInfo = lang.clone(currentAttrs.layerInfo);

        //override layerInfo
        layerInfo.name = queryName;
        //ImageServiceLayer doesn't have drawingInfo
        if (!layerInfo.drawingInfo) {
          layerInfo.drawingInfo = {};
        }

        layerInfo.drawingInfo.transparency = 0;
        layerInfo.minScale = 0;
        layerInfo.maxScale = 0;
        layerInfo.effectiveMinScale = 0;
        layerInfo.effectiveMaxScale = 0;
        layerInfo.defaultVisibility = true;
        delete layerInfo.extent;

        //only keep necessary fields
        var singleQueryLoader = new SingleQueryLoader(this.map, currentAttrs);
        var necessaryFieldNames = singleQueryLoader.getOutputFields();
        layerInfo.fields = array.filter(layerInfo.fields, lang.hitch(this, function (fieldInfo) {
          return necessaryFieldNames.indexOf(fieldInfo.name) >= 0;
        }));
        var featureCollection = {
          layerDefinition: layerInfo,
          featureSet: null
        };

        //For now, we should not add the FeatureLayer into map.
        resultLayer = new FeatureLayer(featureCollection);
        // resultLayer.keepResultsOnMapAfterCloseWidget = currentAttrs.config.keepResultsOnMapAfterCloseWidget;
        //set taskIndex for resutlLayer
        resultLayer._queryWidgetTaskIndex = taskIndex;
        //set popupTemplate
        var popupInfo = lang.clone(currentAttrs.config.popupInfo);
        var popupTemplate = new PopupTemplate(popupInfo);
        if (popupInfo.showAttachments) {
          var url = currentAttrs.config.url;
          var objectIdField = currentAttrs.config.objectIdField;
          queryUtils.overridePopupTemplateMethodGetAttachments(popupTemplate, url, objectIdField);
        }
        resultLayer.setInfoTemplate(popupTemplate);

        currentAttrs.query.resultLayer = resultLayer;

        //set renderer
        //if the layer is a table, resultsSymbol will be null
        if (!queryUtils.isTable(currentAttrs.layerInfo)) {
          if (!currentAttrs.config.useLayerSymbol && currentAttrs.config.resultsSymbol) {
            var symbol = symbolJsonUtils.fromJson(currentAttrs.config.resultsSymbol);
            renderer = new SimpleRenderer(symbol);
            resultLayer.setRenderer(renderer);
          }
        }

        return resultLayer;
      },

      /*---------------------------query result list-------------------------------*/

      _onSingleQueryFinished: function (singleQueryResult, queryName) {
        this.currentTaskSetting.onGetQueryResponse();
        singleQueryResult.placeAt(this.singleResultDetails);
        this._hideAllSingleQueryResultDijits();
        this._switchToResultTab();
        html.setStyle(singleQueryResult.domNode, 'display', 'block');
        var currentAttrs = singleQueryResult.getCurrentAttrs();
        var taskIndex = currentAttrs.queryTr.taskIndex;

        var resultLayerInfo = {
          value: jimuUtils.getRandomString(),
          label: queryName,
          taskIndex: taskIndex,
          singleQueryResult: singleQueryResult
        };
        this._resultLayerInfos.push(resultLayerInfo);

        this.resultLayersSelect.addOption({
          value: resultLayerInfo.value,
          label: resultLayerInfo.label
        });
        this.resultLayersSelect.set('value', resultLayerInfo.value);
        this._showResultLayerInfo(resultLayerInfo);
        this._updateResultDetailUI();
        //-----------------------------JHL Content : Part 2 avgArea---------------------------------------------------------------//
        var SearchResult = resultLayerInfo.singleQueryResult.resultsContainer.firstElementChild.firstElementChild;
        var ResultMainSections = SearchResult.querySelectorAll('div.mainSection');
        console.log(ResultMainSections[0].querySelectorAll('font'));
        var listOfTotalParcelArea = [];
        var listOfNumOfHousehold = [];
        var listOfYearOfBuildingDeterioration = [];
        var listOfFAR = [];
        var listOfOfficialPrice = [];
        var listOfAddress = [];
        //console.log(ResultMainSections.length);
        for (var i = 0; i < ResultMainSections.length; i++) {
          var fontTags = ResultMainSections[i].querySelectorAll('font');
         // console.log(fontTags);
          listOfAddress.push(ResultMainSections[i].firstChild.innerText);
          for (var j = 0; j < fontTags.length; j++) {
            //totalParcel area
            if (j == 1) {
              var fontContent = fontTags[j].innerText;
              var fontContentSplit = fontContent.split(" ");
              var num = fontContentSplit[0];
              var numSplit = num.split(",");
              var bareInt = "";
              for (var k = 0; k < numSplit.length; k++) {
                bareInt += numSplit[k];
                if (k == numSplit.length - 1) {
                  var int = Number.parseInt(bareInt, { places: 2 });
                  listOfTotalParcelArea.push(int);
                  bareInt = "";
                }
              }
            }
            //amount of household
            if (j == 16) {
              var fontContent = fontTags[j].innerText;
              var fontContantSplit = fontContent.split("총");
              var semiNum = fontContantSplit[1];
              var finalNum = semiNum.replace(')', "");
              var int = Number.parseInt(finalNum, { place: 2 });
              listOfNumOfHousehold.push(int);
            }
            //num of deterioration
            if (j == 11) {
              var fontContent = fontTags[j].innerText;
              var fontContantSplit = fontContent.split(" ");
              var semiNum = fontContantSplit[0];
              var int = Number.parseInt(semiNum, { place: 2 });
              listOfYearOfBuildingDeterioration.push(int);
            }
            //num of official price
            if (j == 18) {
              var fontContent = fontTags[j].innerText;
              var fontContentSplit = fontContent.split(" ");
              var num = fontContentSplit[0];
              var numSplit = num.split(",");
              var bareInt = "";
              for (var k = 0; k < numSplit.length; k++) {
                bareInt += numSplit[k];
                if (k == numSplit.length - 1) {
                  var int = Number.parseInt(bareInt, { places: 2 });
                  listOfOfficialPrice.push(int);
                  bareInt = "";
                }
              }
            }
            //find FAR
            if (j == 9) {
              var fontContent = fontTags[j].innerText;
              var fontContantSplit = fontContent.split(" ");
              var semiNum = fontContantSplit[0];
              var float = Number.parseFloat(semiNum);
              if(float!=0){
              listOfFAR.push(float);
              }
            }
            parcelAreaBareNum = listOfTotalParcelArea;
          }
        }


        if (parcelAreaBareNum != null) {
          this.GetPartTwoAreaChartInfo(parcelAreaBareNum);
        }
        if (listOfNumOfHousehold != null) {
          this.GetPartTwoHouseholdChartInfo(listOfNumOfHousehold);
        }
        if (listOfYearOfBuildingDeterioration != null) {
          this.GetPartTwoDeteriorationChartInfo(listOfYearOfBuildingDeterioration);
        }
        if (listOfOfficialPrice != null) {
          this.GetPartTwoPriceChartInfo(listOfOfficialPrice);
        }
        if (listOfFAR != null) {
          this.GetPartTwoFARChartInfo(listOfFAR);
        }
        //----------------------------------------------Part 3 ---------------------------------------------------------------//
        //console.log(ResultMainSections[0].querySelectorAll('div.header')[0].innerText);
        //get title
        var designationTitle = [];
        var totalParcelArea = [];
        var totalParcel = [];
        var totalAvgParcelArea = [];
        var totalGFA = [];
        var totalFAR = [];
        var totalAvgAge = [];
        var totalAOD = [];
        var totalBuilding = [];
        var totalAvgPrice =[];
        var totalAreaType =[];
        var totalParcelAddr = [];

        for(var i = 0;i<ResultMainSections.length;i++){
          designationTitle.push(ResultMainSections[i].querySelectorAll('div.header')[0].innerText);
          for(var j =0;j<ResultMainSections[i].querySelectorAll('font').length;j++){
            var font = ResultMainSections[i].querySelectorAll('font');
            if(j ==1){
              var fontContent = font[j].innerText;
              var fontContentSplit = fontContent.split(" ");
              var num = fontContentSplit[0];
              var numSplit = num.split(",");
              var bareInt = "";
              for (var k = 0; k < numSplit.length; k++) {
                bareInt += numSplit[k];
                if (k == numSplit.length - 1) {
                  var int = Number.parseInt(bareInt, { places: 2 });
                  totalParcelArea.push(int);
                  bareInt = "";
                }
              }
            }else if(j==3){
              totalParcel.push(font[j].innerText);
            }else if(j==5){
              totalAvgParcelArea.push(font[j].innerText);
            }else if(j==7){
              var fontContent = font[j].innerText;
              var fontContentSplit = fontContent.split(" ");
              var num = fontContentSplit[0];
              var numSplit = num.split(",");
              var bareInt = "";
              for (var k = 0; k < numSplit.length; k++) {
                bareInt += numSplit[k];
                if (k == numSplit.length - 1) {
                  var int = Number.parseInt(bareInt, { places: 2 });
                  totalGFA.push(int);
                  bareInt = "";
                }
              }
            }else if(j==9){
              totalFAR.push(font[j].innerText);
            }else if(j==11){
              totalAvgAge.push(font[j].innerText);
            }else if(j==13){
              totalAOD.push(font[j].innerText);
            }else if(j==16){
              var fontSplit = font[j].innerText.split(",");
              var finalContent ="";
              for(var k =0;k<fontSplit.length;k++){
                if(k!=fontSplit.length-1){
                finalContent += fontSplit[k]+"/";
                }else{
                  finalContent += fontSplit[k];
                }
              }
              totalBuilding.push(finalContent);
            }else if(j==18){
              var fontContent = font[j].innerText;
              var fontContentSplit = fontContent.split(" ");
              var num = fontContentSplit[0];
              var numSplit = num.split(",");
              var bareInt = "";
              for (var k = 0; k < numSplit.length; k++) {
                bareInt += numSplit[k];
                if (k == numSplit.length - 1) {
                  var int = Number.parseInt(bareInt, { places: 2 });
                  totalAvgPrice.push(int);
                  bareInt = "";
                }
              }
            }else if(j==20){
              var fontSplit = font[j].innerText.split(",");
              var finalContent ="";
              for(var k =0;k<fontSplit.length;k++){
                if(k!=fontSplit.length-1){
                finalContent += fontSplit[k]+"/";
                }else{
                  finalContent += fontSplit[k];
                }
              }
              totalAreaType.push(finalContent);

            }else if(j==22){
              var fontSplit = font[j].innerText.split(",");
              var finalContent ="";
              for(var k =0;k<fontSplit.length;k++){
                if(k!=fontSplit.length-1){
                finalContent += fontSplit[k]+"/";
                }else{
                  finalContent += fontSplit[k];
                }
              }
              totalParcelAddr.push(finalContent);
            }
          }
        }
        //  console.log(totalParcelArea);
        // console.log(totalAvgParcelArea);
        // console.log(totalGFA);
        // console.log(totalFAR);
        // console.log(totalAvgAge);
        // console.log(totalAOD);
        // console.log(totalBuilding);
        // console.log(totalAvgPrice);
        //  console.log(totalAreaType);
        // console.log(totalParcelAddr);

        sessionStorage.setItem('designationTitle',designationTitle);
        sessionStorage.setItem('totalParcelArea',String(totalParcelArea));
        sessionStorage.setItem('totalParcel',totalParcel);
        sessionStorage.setItem('totalAvgParcelArea',totalAvgParcelArea);
        sessionStorage.setItem('totalGFA',String(totalGFA));
        sessionStorage.setItem('totalFAR',totalFAR);
        sessionStorage.setItem('totalAvgAge',totalAvgAge);
        sessionStorage.setItem('totalAOD',totalAOD);
        sessionStorage.setItem('totalBuilding',totalBuilding);
        sessionStorage.setItem('totalAvgPrice',String(totalAvgPrice));
        sessionStorage.setItem('totalAreaType',totalAreaType);
        sessionStorage.setItem('totalParcelAddr',totalParcelAddr);
      },

      GetEachDesignationData : function(fontTag){

      },
      //area chartInfo
      GetPartTwoAreaChartInfo: function (parcelAreaBareNum) {
        var areaOne = [];
        var areaTwo = [];
        var areaThree = [];
        var areaFour = [];

        //categorize by area and average area
        var sumArea = 0;
        for (var i = 0; i < parcelAreaBareNum.length; i++) {
          sumArea += parcelAreaBareNum[i];
          if (parcelAreaBareNum[i] < 3000) {
            areaOne.push(parcelAreaBareNum[i]);
          } else if (parcelAreaBareNum[i] >= 3000 && parcelAreaBareNum[i] < 6000) {
            areaTwo.push(parcelAreaBareNum[i]);
          } else if (parcelAreaBareNum[i] >= 6000 && parcelAreaBareNum[i] < 9000) {
            areaThree.push(parcelAreaBareNum[i]);
          } else if (parcelAreaBareNum[i] >= 9000) {
            areaFour.push(parcelAreaBareNum[i]);
          }
        }

        var avgArea = Math.round(sumArea / parcelAreaBareNum.length * 10) / 10;
        //console.log(avgArea);

        sessionStorage.setItem('avgArea', String(avgArea));
        sessionStorage.setItem('areaOne', String(areaOne.length));
        sessionStorage.setItem('areaTwo', String(areaTwo.length));
        sessionStorage.setItem('areaThree', String(areaThree.length));
        sessionStorage.setItem('areaFour', String(areaFour.length));
      },

      GetPartTwoHouseholdChartInfo: function (listOfNumOfHousehold) {
        var householdOne = [];
        var householdTwo = [];
        var householdThree = [];
        var householdFour = [];
        var sumOfNumOfHousehold = 0;
        for (var i = 0; i < listOfNumOfHousehold.length; i++) {
          var hh = listOfNumOfHousehold[i];
          sumOfNumOfHousehold += hh;
          if (hh < 10) {
            householdOne.push(hh);
          } else if (hh >= 10 && hh < 30) {
            householdTwo.push(hh);
          } else if (hh >= 30 && hh < 60) {
            householdThree.push(hh);
          } else if (hh >= 60) {
            householdFour.push(hh);
          }
        }
        var avgNumOfHousehold = Math.round(sumOfNumOfHousehold / listOfNumOfHousehold.length * 10) / 10;
        sessionStorage.setItem('avgNumOfHousehold', String(avgNumOfHousehold));
        sessionStorage.setItem('householdOne', String(householdOne.length));
        sessionStorage.setItem('householdTwo', String(householdTwo.length));
        sessionStorage.setItem('householdThree', String(householdThree.length));
        sessionStorage.setItem('householdFour', String(householdFour.length));

        // console.log(avgNumOfHousehold);
        // console.log(householdOne);
        // console.log(householdTwo);
        // console.log(householdThree);
        // console.log(householdFour);


      },

      GetPartTwoDeteriorationChartInfo: function (listOfYearOfBuildingDeterioration) {
        var deteriorationOne = [];
        var deteriorationTwo = [];
        var deteriorationThree = [];
        var deteriorationFour = [];
        var sumOfYearOfDeterioration = 0;
        for (var i = 0; i < listOfYearOfBuildingDeterioration.length; i++) {
          var yd = listOfYearOfBuildingDeterioration[i];
          sumOfYearOfDeterioration += yd;
          if (yd < 10) {
            deteriorationOne.push(yd);
          } else if (yd >= 10 && yd < 20) {
            deteriorationTwo.push(yd);
          } else if (yd >= 20 && yd < 30) {
            deteriorationThree.push(yd);
          } else if (yd > 30) {
            deteriorationFour.push(yd);
          }
        }
        var avgOfYearOfDeterioration = Math.round(sumOfYearOfDeterioration / listOfYearOfBuildingDeterioration.length * 10) / 10;
        sessionStorage.setItem('avgOfYearOfDeterioration', String(avgOfYearOfDeterioration));
        sessionStorage.setItem('deteriorationOne', String(deteriorationOne.length));
        sessionStorage.setItem('deteriorationTwo', String(deteriorationTwo.length));
        sessionStorage.setItem('deteriorationThree', String(deteriorationThree.length));
        sessionStorage.setItem('deteriorationFour', String(deteriorationFour.length));
        // console.log(avgOfYearOfDeterioration);
        // console.log(deteriorationOne);
        // console.log(deteriorationTwo);
        // console.log(deteriorationThree);
        // console.log(deteriorationFour);
      },

      GetPartTwoPriceChartInfo: function (listOfOfficialPrice) {
        var priceOne = [];
        var priceTwo = [];
        var priceThree = [];
        var priceFour = [];
        var sumOfOfficialPrice = 0;

        listOfOfficialPrice.sort(function (a, b) {
          return a - b;
        })
        var lowestPrice = listOfOfficialPrice[0];
        var highestPrice = listOfOfficialPrice[listOfOfficialPrice.length - 1];
        console.log(lowestPrice);
        console.log(highestPrice);
        var opc = this.OfficialPriceCategorization(lowestPrice, highestPrice);

        for (var i = 0; i < listOfOfficialPrice.length; i++) {
          var op = listOfOfficialPrice[i];
          sumOfOfficialPrice += op;
          if (op < opc[0]) {
            priceOne.push(op);
          } else if (op >= opc[0] && op < opc[1]) {
            priceTwo.push(op);
          } else if (op >= opc[1] && op < opc[2]) {
            priceThree.push(op);
          } else if (op >= opc[2]) {
            priceFour.push(op);
          }
        }
        var avgOfficialPrice = Math.round(sumOfOfficialPrice / listOfOfficialPrice.length * 10) / 10;
        //  console.log(priceOne);
        //  console.log(priceTwo);
        //  console.log(priceThree);
        //  console.log(priceFour);
        sessionStorage.setItem('avgOfficialPrice', String(avgOfficialPrice));
        sessionStorage.setItem('priceOne', String(priceOne.length));
        sessionStorage.setItem('priceTwo', String(priceTwo.length));
        sessionStorage.setItem('priceThree', String(priceThree.length));
        sessionStorage.setItem('priceFour', String(priceFour.length));

        sessionStorage.setItem('priceLegend1',String(opc[0]));
        sessionStorage.setItem('priceLegend2',String(opc[1]));
        sessionStorage.setItem('priceLegend3',String(opc[2]));

      },

      OfficialPriceCategorization: function (lowestPrice, highestPrice) {
       // console.log(lowestPrice);
       // console.log(highestPrice);
        var officialPriceCategory = [];
        var priceDifference = (highestPrice - lowestPrice) / 4;
       // console.log(priceDifference);
        var firstLimit = Math.round((lowestPrice + priceDifference) / 10000) * 10000;
        var secondLimit = Math.round((firstLimit + priceDifference) / 10000) * 10000;
        var thirdLimit = Math.round((secondLimit + priceDifference) / 10000) * 10000;

        // console.log(firstLimit);
        // console.log(secondLimit);
        // console.log(thirdLimit);

        officialPriceCategory.push(firstLimit);
        officialPriceCategory.push(secondLimit);
        officialPriceCategory.push(thirdLimit);
        return officialPriceCategory;
      },

      GetPartTwoFARChartInfo: function (listOfFAR) {
        var FAROne = [];
        var FARTwo = [];
        var FARThree = [];
        var FARFour = [];
        var sumOfFAR = 0;
        for (var i = 0; i < listOfFAR.length; i++) {
          var far = listOfFAR[i];
          sumOfFAR += far;
          if (far < 100) {
            FAROne.push(far);
          } else if (far >= 100 && far < 150) {
            FARTwo.push(far);
          } else if (far >= 150 && far < 200) {
            FARThree.push(far);
          } else if (far >= 200) {
            FARFour.push(far);
          }
        }
        var avgFAR = Math.round(sumOfFAR / listOfFAR.length * 10) / 10;
        sessionStorage.setItem('avgFAR', String(avgFAR));
        sessionStorage.setItem('FAROne', String(FAROne.length));
        sessionStorage.setItem('FARTwo', String(FARTwo.length));
        sessionStorage.setItem('FARThree', String(FARThree.length));
        sessionStorage.setItem('FARFour', String(FARFour.length));
        //  console.log(avgFAR);
        //  console.log(FAROne);
        //  console.log(FARTwo);
        //  console.log(FARThree);
        //  console.log(FARFour);

      },


      _onResultLayerSelectChanged: function () {
        var resultLayerInfo = this._getCurrentResultLayerInfo();
        if (resultLayerInfo) {
          this._showResultLayerInfo(resultLayerInfo);
        }
      },

      _getCurrentResultLayerInfo: function () {
        var resultLayerInfo = null;
        var value = this.resultLayersSelect.get('value');
        if (value) {
          resultLayerInfo = this._getResultLayerInfoByValue(value);
        }
        return resultLayerInfo;
      },

      _hideAllLayers: function (/*optional*/ ignoredSingleQueryResult) {
        var dijits = this._getAllSingleQueryResultDijits();
        array.forEach(dijits, lang.hitch(this, function (singleQueryResult) {
          if (singleQueryResult && singleQueryResult !== ignoredSingleQueryResult) {
            singleQueryResult.hideLayer();
          }
        }));
      },

      _removeResultLayerInfosByTaskIndex: function (taskIndex) {
        var resultLayerInfos = this._getResultLayerInfosByTaskIndex(taskIndex);
        this._removeResultLayerInfos(resultLayerInfos);
      },

      _getResultLayerInfoByValue: function (value) {
        var resultLayerInfo = null;
        array.some(this._resultLayerInfos, lang.hitch(this, function (item) {
          if (item.value === value) {
            resultLayerInfo = item;
            return true;
          } else {
            return false;
          }
        }));
        return resultLayerInfo;
      },

      _getResultLayerInfosByTaskIndex: function (taskIndex) {
        var resultLayerInfos = this._resultLayerInfos;
        resultLayerInfos = array.filter(resultLayerInfos, lang.hitch(this, function (resultLayerInfo) {
          return resultLayerInfo.taskIndex === taskIndex;
        }));
        return resultLayerInfos;
      },

      _removeResultLayerInfoByValues: function (values) {
        var indexArray = [];
        array.forEach(this._resultLayerInfos, lang.hitch(this, function (resultLayerInfo, index) {
          if (values.indexOf(resultLayerInfo.value) >= 0) {
            indexArray.push(index);
            if (resultLayerInfo.singleQueryResult && resultLayerInfo.singleQueryResult.domNode) {
              resultLayerInfo.singleQueryResult.destroy();
            }
            resultLayerInfo.singleQueryResult = null;
          }
        }));
        indexArray.reverse();
        array.forEach(indexArray, lang.hitch(this, function (index) {
          this._resultLayerInfos.splice(index, 1);
        }));
        this.resultLayersSelect.removeOption(values);

        var options = this.resultLayersSelect.getOptions();
        if (options && options.length > 0) {
          this.resultLayersSelect.set('value', options[0].value);
        } else {
          if (typeof this.resultLayersSelect._setDisplay === "function") {
            this.resultLayersSelect._setDisplay("");
          }
        }

        this._updateResultDetailUI();
      },

      _removeResultLayerInfos: function (resultLayerInfos) {
        var values = array.map(resultLayerInfos, lang.hitch(this, function (resultLayerInfo) {
          return resultLayerInfo.value;
        }));
        return this._removeResultLayerInfoByValues(values);
      },

      _getAllSingleQueryResultDijits: function () {
        var dijits = [];

        if (this._resultLayerInfos && this._resultLayerInfos.length > 0) {
          array.forEach(this._resultLayerInfos, lang.hitch(this, function (resultLayerInfo) {
            if (resultLayerInfo && resultLayerInfo.singleQueryResult) {
              dijits.push(resultLayerInfo.singleQueryResult);
            }
          }));
        }

        return dijits;
      },

      _hideAllSingleQueryResultDijits: function () {
        var dijits = this._getAllSingleQueryResultDijits();
        array.forEach(dijits, lang.hitch(this, function (dijit) {
          html.setStyle(dijit.domNode, 'display', 'none');
        }));
      },

      _showResultLayerInfo: function (resultLayerInfo) {
        this._hideAllSingleQueryResultDijits();
        var singleQueryResult = resultLayerInfo.singleQueryResult;
        this._hideAllLayers(singleQueryResult);
        if (singleQueryResult) {
          html.setStyle(singleQueryResult.domNode, 'display', 'block');
          singleQueryResult.showLayer();
          singleQueryResult.zoomToLayer();
        }
      },

      removeSingleQueryResult: function (singleQueryResult) {
        var value = null;
        array.some(this._resultLayerInfos, lang.hitch(this, function (resultLayerInfo) {
          if (resultLayerInfo.singleQueryResult === singleQueryResult) {
            value = resultLayerInfo.value;
            return true;
          } else {
            return false;
          }
        }));
        if (value !== null) {
          this._removeResultLayerInfoByValues([value]);
        }
      },

      _onShowRelatedRecords: function () {
        html.addClass(this.resultLayersSelectDiv, this.hiddenClass);
      },

      _onHideRelatedRecords: function () {
        html.removeClass(this.resultLayersSelectDiv, this.hiddenClass);
      },

      /*-------------------------common functions----------------------------------*/

      _isImageServiceLayer: function (url) {
        return (url.indexOf('/ImageServer') > -1);
      },

      _showQueryErrorMsg: function (/* optional */ msg) {
        new Message({ message: msg || this.nls.queryError });
      },

      _hideInfoWindow: function () {
        if (this.map && this.map.infoWindow) {
          this.map.infoWindow.hide();
          if (typeof this.map.infoWindow.setFeatures === 'function') {
            this.map.infoWindow.setFeatures([]);
          }
        }
      }

    });
  });