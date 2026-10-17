var regedit = require('regedit')

var installPath = process.execPath

var keysToCreate = [
  'HKCU\\Software\\Classes\\Zephyr',
  'HKCU\\Software\\Classes\\Zephyr\\Application',
  'HKCU\\Software\\Classes\\Zephyr\\DefaulIcon',
  'HKCU\\Software\\Classes\\Zephyr\\shell\\open\\command',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\FileAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\StartMenu',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\URLAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\DefaultIcon',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\InstallInfo',
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\shell\\open\\command'
]

var registryConfig = {
  'HKCU\\Software\\RegisteredApplications': {
    Zephyr: {
      value: 'Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\Zephyr': {
    default: {
      value: 'Zephyr Browser Document',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Classes\\Zephyr\\Application': {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    },
    ApplicationName: {
      value: 'Zephyr',
      type: 'REG_SZ'
    },
    AppUserModelId: {
      value: 'Zephyr',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\Zephyr\\DefaulIcon': {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\Zephyr\\shell\\open\\command': {
    default: {
      value: '"' + installPath + '" "%1"',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Classes\\.htm\\OpenWithProgIds': {
    Zephyr: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\.html\\OpenWithProgIds': {
    Zephyr: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\FileAssociations': {
    '.htm': {
      value: 'Zephyr',
      type: 'REG_SZ'
    },
    '.html': {
      value: 'Zephyr',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\StartMenu': {
    StartMenuInternet: {
      value: 'Zephyr',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\Capabilities\\URLAssociations': {
    http: {
      value: 'Zephyr',
      type: 'REG_SZ'
    },
    https: {
      value: 'Zephyr',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\DefaultIcon': {
    default: {
      value: installPath + ',0',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\InstallInfo': {
    IconsVisible: {
      value: 1,
      type: 'REG_DWORD'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\Zephyr\\shell\\open\\command': {
    default: {
      value: installPath,
      type: 'REG_DEFAULT'
    }
  }
}

var registryInstaller = {
  install: function () {
    return new Promise(function (resolve, reject) {
      regedit.createKey(keysToCreate, function (err) {
        regedit.putValue(registryConfig, function (err) {
          if (err) {
            reject()
          } else {
            resolve()
          }
        })
      })
    })
  },
  uninstall: function () {
    return new Promise(function (resolve, reject) {
      regedit.deleteKey(keysToCreate, function (err) {
        if (err) {
          reject()
        } else {
          resolve()
        }
      })
    })
  }
}
