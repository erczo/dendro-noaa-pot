'use strict'

/**
 * Digital Weather Markup Language (DWML) document parser classes.
 *
 * Based on https://graphical.weather.gov/xml/mdl/XML/Design/MDL_XML_Design.pdf
 */

const fs = require('fs')
const path = require('path')
const moment = require('moment')
const DOMParser = require('xmldom').DOMParser

/*
  Why oh why are the node type constants not exposed? Adding these to our faux Node interface.

  SEE: https://github.com/jindw/xmldom/pull/151
 */
const Node = {
  ELEMENT_NODE: 1
  // NOTE: Not used
  // ATTRIBUTE_NODE: 2,
  // TEXT_NODE: 3,
  // CDATA_SECTION_NODE: 4,
  // ENTITY_REFERENCE_NODE: 5,
  // ENTITY_NODE: 6,
  // PROCESSING_INSTRUCTION_NODE: 7,
  // COMMENT_NODE: 8,
  // DOCUMENT_NODE: 9,
  // DOCUMENT_TYPE_NODE: 10,
  // DOCUMENT_FRAGMENT_NODE: 11,
  // NOTATION_NODE: 12
}

class DWMLLocation {
  constructor (dwmlDoc, locationEl) {
    this.element = locationEl
  }

  get locationKey () {
    if (this._locationKey) return this._locationKey

    const els = this.element.getElementsByTagName('location-key')
    return (this._locationKey = els.length > 0 ? els[0].firstChild.nodeValue : null)
  }

  get point () {
    if (this._point) return this._point

    const point = {}
    const pointEls = this.element.getElementsByTagName('point')

    if (pointEls.length > 0) {
      const pointEl = pointEls[0]
      point.latitude = parseFloat(pointEl.getAttribute('latitude'))
      point.longitude = parseFloat(pointEl.getAttribute('longitude'))
    }

    return (this._point = point)
  }
}

class DWMLTimeLayout {
  constructor (dwmlDoc, timeLayoutEl) {
    this.element = timeLayoutEl
  }

  get layoutKey () {
    if (this._layoutKey) return this._layoutKey

    const els = this.element.getElementsByTagName('layout-key')
    return (this._layoutKey = els.length > 0 ? els[0].firstChild.nodeValue : null)
  }

  get parsedKey () {
    const key = this.layoutKey
    const parsed = {}

    if (key) {
      const parts = key.split('-')
      parsed.period = parts[1]
      parsed.times = parts[2]
      parsed.seq = parseInt(parts[3])
    }

    return parsed
  }

  get timeCoordinate () {
    return this.element.getAttribute('time-coordinate')
  }

  get validTimes () {
    return this._validTimes ? this._validTimes : (this._validTimes = Array.from(this.validTimeGen()))
  }

  // eslint-disable-next-line
  *validTimeGen () {
    const startEls = this.element.getElementsByTagName('start-valid-time')
    const endEls = this.element.getElementsByTagName('end-valid-time')

    for (let i = 0; i < startEls.length; i++) {
      const startString = startEls[i].firstChild.nodeValue
      const startMoment = moment.parseZone(startString)
      const obj = {
        startDate: startMoment.toDate(),
        startOffset: startMoment.utcOffset() * 60,
        startString: startString
      }

      if (endEls[i]) {
        const endString = endEls[i].firstChild.nodeValue
        const endMoment = moment.parseZone(endString)
        obj.endDate = endMoment.toDate()
        obj.endOffset = endMoment.utcOffset() * 60
        obj.endString = endString
      }

      yield obj
    }
  }
}

class DWMLParameter {
  constructor (dwmlDoc, parametersEl, parameterEl) {
    this.element = parameterEl

    const locationKey = this.locationKey = parametersEl.getAttribute('applicable-location')
    if (locationKey) this.location = dwmlDoc.locations[locationKey]

    const layoutKey = this.timeLayoutKey = parameterEl.getAttribute('time-layout')
    if (layoutKey) this.timeLayout = dwmlDoc.timeLayouts[layoutKey]
  }

  get elementName () {
    return this.element.nodeName
  }

  get name () {
    if (this._name) return this._name

    const els = this.element.getElementsByTagName('name')
    return (this._name = els.length > 0 ? els[0].firstChild.nodeValue : null)
  }

  get type () {
    return this.element.getAttribute('type')
  }
}

class DWMLConditionsIconsParameter extends DWMLParameter {
  get iconLinks () {
    return Array.from(this.iconLinkGen())
  }

  // eslint-disable-next-line
  *iconLinkGen () {
    const iconLinkEls = this.element.getElementsByTagName('icon-link')

    for (let i = 0; i < iconLinkEls.length; i++) {
      yield iconLinkEls[i].firstChild.nodeValue
    }
  }

  get series () {
    return Array.from(this.seriesGen())
  }

  // eslint-disable-next-line
  *seriesGen () {
    if (!this.timeLayout) return

    const validTimes = this.timeLayout.validTimes
    let i = 0

    for (const iconLink of this.iconLinkGen()) {
      const validTime = validTimes[i++]

      if (validTime) {
        yield {
          time: validTime,
          url: iconLink
        }
      }
    }
  }
}

class DWMLUnitsParameter extends DWMLParameter {
  get units () {
    return this.element.getAttribute('units')
  }

  get values () {
    return Array.from(this.valueGen())
  }

  // eslint-disable-next-line
  *valueGen () {
    const valueEls = this.element.getElementsByTagName('value')

    for (let i = 0; i < valueEls.length; i++) {
      yield parseFloat(valueEls[i].firstChild.nodeValue)
    }
  }

  get series () {
    return Array.from(this.seriesGen())
  }

  // eslint-disable-next-line
  *seriesGen () {
    if (!this.timeLayout) return

    const validTimes = this.timeLayout.validTimes
    let i = 0

    for (const value of this.valueGen()) {
      const validTime = validTimes[i++]

      if (validTime) {
        yield {
          time: validTime,
          value: value
        }
      }
    }
  }
}

const ELEMENT_NAME_TO_PARAMETER_CLASS = {
  'conditions-icon': DWMLConditionsIconsParameter,
  'conditions-icons': DWMLConditionsIconsParameter,
  'probability-of-precipitation': DWMLUnitsParameter,
  'temperature': DWMLUnitsParameter
}

class DWMLDocument {
  constructor (xmlDoc) {
    const dataEls = xmlDoc.getElementsByTagName('data')

    if (dataEls.length === 0) throw new Error('Missing data element')

    this.dataElement = dataEls[0]
    this.xmlDocument = xmlDoc
  }

  get locations () {
    return this._locations ? this._locations : (this._locations = Array.from(this.locationGen()).reduce((obj, cur) => {
      obj[cur.locationKey] = cur
      return obj
    }, {}))
  }

  // eslint-disable-next-line
  *locationGen () {
    const locationEls = this.dataElement.getElementsByTagName('location')

    for (let i = 0; i < locationEls.length; i++) {
      yield new DWMLLocation(this, locationEls[i])
    }
  }

  get parameters () {
    return this._parameters ? this._parameters : (this._parameters = Array.from(this.parameterGen()))
  }

  // eslint-disable-next-line
  *parameterGen () {
    const parametersEls = this.dataElement.getElementsByTagName('parameters')

    for (let i = 0; i < parametersEls.length; i++) {
      const parametersEl = parametersEls[i]
      const nds = parametersEl.childNodes

      for (let j = 0; j < nds.length; j++) {
        const nd = nds[j]

        if (nd.nodeType === Node.ELEMENT_NODE) {
          const Klass = ELEMENT_NAME_TO_PARAMETER_CLASS[nd.nodeName]
          if (Klass) yield new Klass(this, parametersEl, nd)
        }
      }
    }
  }

  get timeLayouts () {
    return this._timeLayouts ? this._timeLayouts : (this._timeLayouts = Array.from(this.timeLayoutGen()).reduce((obj, cur) => {
      obj[cur.layoutKey] = cur
      return obj
    }, {}))
  }

  // eslint-disable-next-line
  *timeLayoutGen () {
    const timeLayoutEls = this.dataElement.getElementsByTagName('time-layout')

    for (let i = 0; i < timeLayoutEls.length; i++) {
      yield new DWMLTimeLayout(this, timeLayoutEls[i])
    }
  }
}

new Promise((resolve, reject) => {
  // Read input
  fs.readFile(path.join(__dirname, 'input.xml'), 'utf8', (err, data) => {
    err ? reject(err) : resolve(data)
  })
}).then(data => {
  // Parse
  return new DOMParser().parseFromString(data, 'text/xml')
}).then(xmlDoc => {
  const dwml = new DWMLDocument(xmlDoc)

  dwml.parameters.forEach(parameter => {
    console.log('>>>', parameter.elementName, parameter.name, parameter.type, parameter.units)
    console.log('   ', parameter.timeLayout.parsedKey)
    console.log('   ', parameter.location.point)
    console.log('   ', parameter.series)
  })
}).catch(err => {
  console.error(err)
})
