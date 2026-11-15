<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template name="entry-row">
    <xsl:param name="indent"/>
    <tr><xsl:call-template name="cell"/></tr>
  </xsl:template>
  <xsl:template name="cell">
    <td><xsl:value-of select="name"/></td>
  </xsl:template>
</xsl:stylesheet>
